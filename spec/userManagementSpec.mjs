import { Credentials, MutableCollection, VersionedCollection } from '@kilroy-code/flexstore';
import { Rule } from '@kilroy-code/rules';
import { User, FairShareGroup, Message, Member } from '../models.mjs';
const { describe, beforeAll, afterAll, it, expect, expectAsync } = globalThis;

Object.assign(globalThis, {User, FairShareGroup, Message, Credentials, MutableCollection, VersionedCollection}); // for debugging in browser

// TODO:
// voting: admit
// voting: expell
// voting: tax
// voting: stipend
// voting: rollback
// voting: mint
// merging: with rollback
// merging: with tax/stipend votes by a user expelled in another branch
// merging: with admit votes by a user expelled in another branch

function timeLimit(nKeysCreated = 1) { // Time to create a key set varies quite a bit (deliberately).
  return (nKeysCreated * 6e3) + 6e3;
}

describe("Model management", function () {
  let authorizedMember,
      deviceName = 'test',
      bankTag;

  // Reusable assertions for our testing.
  async function expectGone(kind, tag) { // get, so as not to get false negative if present but not valid.
    const signature = await kind.get(tag);
    expect(signature).toBeFalsy();
  }
  async function expectNoKey(tag) { // Confirm that tag does not exist as a key.
    // Note: This does not check that keys that may once have been members of tag have also been removed.
    // To check that, one needs to manually inspect the persistent storage.
    await expectGone(Credentials.collections.Team, tag);
    await expectGone(Credentials.collections.EncryptionKey, tag);
    await expectGone(Credentials.collections.KeyRecovery, tag);
  }
  async function expectMember(userTag, groupTag, {
    expectUserData = true, userTitle = '',
    isMember = true, groupActor = userTag, expectGroupData = true, groupTitle = '',
    debug = false
  } = {}) {
    // Confirm properties for user being a member of group.
    // This is reaching under the hood to the level of persisted artifacts.
    const userData = await User.listingCollection.retrieve(userTag);               // User data.
    const userPrivateData = await User.collection.retrieve(userTag);
    const user = expectUserData && await User.fetch(userTag, true);
    if (expectUserData) {
      if (userTitle === null) {
	expect(userData).toBeFalsy();
	expect(user.title).toBeFalsy();
      } else {
	expect(userData.protectedHeader.kid).toBe(userTag);                    // Signed by one Key IDentifer.
	if (userTitle) {
	  expect(userData.json.title).toBe(userTitle);
	  expect(user.title).toBe(userTitle);
	}
      }
      expect(userPrivateData.protectedHeader.kid).toBe(userTag);
      expect(userPrivateData.protectedHeader.cty).toContain('encrypted');
      expect(userPrivateData.decrypted.protectedHeader.kid).toBe(userTag);
      if (isMember) {
	expect(userPrivateData.json.groups).toContain(groupTag); // User's groups list includes the specified group.
	expect(user.groups).toContain(groupTag);
      } else expect(userPrivateData.json.groups).not.toContain(groupTag);
    } else {
      expect(userPrivateData).toBeFalsy();
    }

    // Get data regardless of whether user is a member of team, as that is checked below.
    const groupData = await FairShareGroup.listingCollection.retrieve({tag: groupTag, member: null});  // Group Data
    const groupPrivateData = await FairShareGroup.collection.retrieve({tag: groupTag, member: null});
    const group = expectGroupData && await FairShareGroup.fetch(groupTag, true);
    if (expectGroupData) {
      if (groupTitle === null) {
	expect(groupData).toBeFalsy();
      } else {
	const {kid:ukid, iss:uowner = ukid, act:uauthor = ukid} = groupData.protectedHeader;
	expect(uowner || ukid).toBe(groupTag);                   // Signed by the group itself (ISSuer).
	if (groupActor) expect(uauthor).toBe(groupActor);                 // Signed by a then-current member (ACTor).
	if (groupTitle) {
	  expect(groupData.json.title).toBe(groupTitle);
	  expect(group.title).toBe(groupTitle);
	}
      }
      const {kid:vkid, iss:vowner = vkid, act:vauthor = vkid} = groupPrivateData.protectedHeader;
      expect(vowner || vkid).toBe(groupTag);
      if (groupActor) expect(vauthor).toBe(groupActor);
      expect(groupPrivateData.protectedHeader.cty).toContain('encrypted');
      expect(groupPrivateData.decrypted.protectedHeader.kid).toBe(groupTag);
      if (isMember) {
	expect(groupPrivateData.json.users).toContain(userTag);   // Group's user data list includes the specified user.
	expect(group.users).toContain(userTag);
      } else expect(groupPrivateData.json.users).not.toContain(userTag);
    } else {
      expect(groupData).toBeFalsy();
      expect(await FairShareGroup.collection.get(groupTag)).toBeFalsy();
    }

    const keyData = await Credentials.collections.Team.retrieve({tag: groupTag, member: null});         // Key data.
    if (expectGroupData) {
      expect(keyData.protectedHeader.iss).toBe(groupTag);                                                 // Signed by the group itself (ISSuer).
      // TODO: Currently, changeMembership does not allow you to specify which actor to be, and it picks
      // a member that you are entitled to use. Thus in this testing, a different member such as authorizedMember may be chosen.
      // expect(keyData.protectedHeader.act).toBe(keyActor);  // Signed by a then-current member (ACTor).
      expect((groupTag === userTag) || // Personal group tag is same as it's user tag
	     keyData.json.recipients.some(recipient => recipient.header.kid === userTag)  // User can decode group key.
	    ).toBe(isMember);
    } else {
      expect(keyData).toBeFalsy();
    }
  }
  async function expectMessages(group, expectedResults) {
    //let messages = group.messages.map(m => ({title:m.title, from:m.author.title, in:m.owner.title, type:m.type}));
    const messages = [];
    let latest = await Message.fetch(group.tag, true);
    let message = await latest.subject;
    while (message) {
      let {title, author, owner, type} = message;
      author = await author;
      owner = await owner;
      const from = author.title;
      const of = owner.title;
      const antecedent = await message.antecedent;
      messages.push({title, from, of, type});
      message = antecedent;
    }
    messages.reverse();
    expect(messages).toEqual(expectedResults);
  }

  beforeAll(async function () {
    // Bootstrap bank group using temporary user credentials.
    const bootstrapUserTag = await Credentials.create(); // No user object.
    const bootstrapUser = {tag:bootstrapUserTag}; // We don't need a full-blown User object here, but we do not an object with a tag property.
    bankTag = await Credentials.create(bootstrapUserTag);
    const bank = await new FairShareGroup({title: "First YZ Bank", tag: bankTag}); // Not create, as author isn't a full User.
    // Arrange for it to be findable from tag by User.create():
    FairShareGroup.directory.set(bankTag, bank);
    await bank.persist(bootstrapUser);

    // Using the bootstrap users, construct a real authorized member of the bank.
    globalThis.authorizedMember = authorizedMember = await User.create({title: 'user A', secrets:[['q0', "17"]], deviceName, bankTag});
    await bank.verified;
    await Credentials.changeMembership({tag: bankTag, remove: [bootstrapUserTag]});
    bank.author = null;
    await Credentials.destroy(bootstrapUserTag);

    // Check our starting conditions.
    await expectMember(bootstrapUserTag, bankTag, {isMember: false, expectUserData: false, groupActor: authorizedMember.tag});
    await expectMember(authorizedMember.tag, bankTag, {userTitle: 'user A', groupTitle: "First YZ Bank"});
    await expectNoKey(bootstrapUserTag);
  }, timeLimit(3)); // Key creation is deliberately slow.

  afterAll(async function () { // Remove everything we have created. (But not whole collections as this may be "live".)
    await authorizedMember.destroy({prompt: 'q0', answer: "17"});
    await expectGone(User.collection, authorizedMember.tag);
    await expectGone(User.listingCollection, authorizedMember.tag);
    await expectNoKey(authorizedMember.tag);
    // authorizedMember was the last member of the bank, so destroying the user destroyed the bank.
    await expectGone(FairShareGroup.collection, bankTag);
    await expectGone(FairShareGroup.listingCollection, bankTag);
    await expectNoKey(bankTag);
  }, timeLimit(1));

  describe("user", function () {
    let user;
    beforeAll(async function () {
      user = await User.create({title: 'user B', secrets:[['q1', "42"]], deviceName, bankTag});
    }, timeLimit(1));

    it("has a bank.", async function () {
      await expectMember(user.tag, bankTag, {userTitle: 'user B', groupTitle: "First YZ Bank", groupActor: null});
    });

    it("has personal group.", async function () {
      await expectMember(user.tag, user.tag,           {userTitle: 'user B', groupTitle: null});

      expect(await FairShareGroup.listingCollection.list()).not.toContain(user.tag); // Not listed in public persistent data.
      expect(FairShareGroup.directory.has(user.tag)).toBeTruthy(); // In session where instance was made or fetched.

      const group = await FairShareGroup.fetch(user.tag); // Works because of previous line.
      expect(group.title).toBe("Yourself");      // From rule, not from persisted data.
      expect(group.users).toEqual([user.tag]);
      expect(user.groups).toContain(group.tag);

      // Simulate a new session without adoption.
      FairShareGroup.directory.delete(user.tag);
      let fetched = await FairShareGroup.fetch(user.tag);
      expect(fetched).not.toBe(group);   // A new (empty) Group instance.
      expect(fetched.users).toEqual([]); // Because it has not fetched private data.
      // Now adopt
      FairShareGroup.directory.delete(user.tag);
      fetched = await FairShareGroup.fetch(user.tag, user);
      expect(fetched.users).toEqual([user.tag]);
    });

    it("authorizes/deauthorizes existing user on device.", async function () {
      const prompt = 'q1', answer = "17", deviceName = "E's device";
      const user = await User.create({title: 'user E', secrets:[[prompt, answer]], deviceName, bankTag});

      expect(await user.preConfirmOwnership({prompt, answer})).toBeTruthy();
      expect(await user.preConfirmOwnership({prompt, answer: answer+'x'})).toBeFalsy();

      const removed = await user.deauthorize({prompt, answer, deviceName});
      expectGone(Credentials.collections.EncryptionKey, removed); // Device gone, too, but we don't get to see those.
      // Tests behavior with access to user.tag allowed and even the device tag allowed in principle, but they have to be be re-fetched
      // which will fail without access to the recovery tag (which is not enumerated here).
      // (Console will log an attempt to access the recovery tag.)
      const attempt = await User.collection.withRestrictedTags([user.tag, removed], () =>
	user.edit({picture: 'wrong'}).catch(() =>'rejected'));
      expect(attempt).toBe('rejected');

      await user.authorize({prompt, answer, deviceName});
      await user.edit({picture: 'after re-authorization'}); // Now editable.
      expect(user.picture).toBe('after re-authorization');

      await user.destroy({prompt, answer});                 // And destroyable.
      await expectMember(user.tag, bankTag, {isMember: false, expectUserData: false});
    }, timeLimit(1));

    it("can edit public and private data.", async function () {
      const {tag, picture, groups, devices} = user;      // Private data before editing.

      await user.edit({picture: "foo bar"});             // Change public data.
      expect(user.picture).toBe("foo bar");              // In object.
      const verified1 = await User.listingCollection.retrieve(tag);
      const verified2 = await User.collection.retrieve(tag);
      expect(verified1.json.picture).toBe("foo bar");    // Persisted
      expect(user.title).toBe('user B');                 // Other public data unchanged.
      expect(verified1.json.title).toBe('user B');
      expect(user.groups).toBe(groups);                  // Private data unchanged.
      expect(verified2.json.groups).toEqual(groups);

      const devices2 = {...devices, foo: 'bar'};         // Change private data.
      await user.edit({devices: devices2});
      expect(devices).not.toBe(devices2);
      expect(user.devices).toBe(devices2);      
      expect(user.devices.foo).toBe('bar');              // In object
      const verified3 = await User.listingCollection.retrieve(tag);
      const verified4 = await User.collection.retrieve(tag);
      expect(verified4.json.devices.foo).toBe('bar');    // Persisted
      expect(user.groups).toBe(groups);                  // Other private data unchanged.
      expect(verified4.json.groups).toEqual(groups);     
      expect(user.title).toBe('user B');                 // Public data unchanged.
      expect(verified3.json.title).toBe('user B');
      
      await user.edit({devices, picture});               // Restore
    });

    it("updates public and private data.", async function () {
      const tag = user.tag;
      const userListing = await User.listingCollection.retrieve(tag);
      const userPrivate = await User.collection.retrieve({tag, decrypt: false});

      // Make another user to model some different data from.
      const prompt = 'q1', answer = 'a1';
      const other = await User.create({title: 'fred', secrets:[[prompt, answer]], deviceName: 'something else', bankTag});
      const otherListing = await User.listingCollection.retrieve(other.tag);
      const otherPrivate = await User.collection.retrieve({tag: other.tag, decrypt: false});

      await User.update(tag, otherListing);
      await User.update(tag, otherPrivate);
      await other.destroy({prompt, answer}); // otherPrivate was encrypted for other.tag, so we had to keep this around long enough to decrypt.
      expect(user.title).toBe('fred');
      expect(user.devices['something else']).toBeTruthy();

      // Restore
      await User.update(tag, userListing);
      await User.update(tag, userPrivate);
      expect(await User.fetch(tag)).toBe(user);
      expect(user.title).toBe('user B');
      expect(user.devices['something else']).toBeFalsy();
    }, timeLimit(1));

    afterAll(async function () {
      // Removes user from personal group.
      await user.destroy({prompt: 'q1', answer: "42"});
      await expectMember(user.tag, user.tag,           {isMember: false, expectUserData: false, expectGroupData: false});
      await expectMember(user.tag, bankTag, {isMember: false, expectUserData: false});
      await expectNoKey(user.tag);
    });    
  });

  describe("groups", function () {
    it("can be created and destroyed", async function () {
      // Have authorizedMember create a Group.
      const group = await authorizedMember.createGroup({title: 'group B'});
      await expectMember(authorizedMember.tag, group.tag, {userTitle: 'user A', groupTitle: 'group B'});

      // Destroy removes the member.
      await authorizedMember.destroyGroup(group);
      await expectMember(authorizedMember.tag, group.tag, {isMember: false, expectGroupData: false, userTitle: 'user A'});
    }, timeLimit(1));

    it("has title defaulting to 'Yourself' if one member.", async function () {
      const group = await authorizedMember.createGroup();
      expect(group.title).toBe("Yourself");
      await authorizedMember.destroyGroup(group);
    }, timeLimit(1));

    it("has title defaulting to list of multiple short member names.", async function () {
      const group = await authorizedMember.createGroup();
      const prompt = 'q1', answer = 'a2', deviceName = 'x';
      const u1 = await User.create({title: "Cher", secrets:[[prompt, answer]], deviceName, bankTag});
      const u2 = await User.create({title: "megan thee stallion", secrets:[[prompt, answer]], deviceName, bankTag});

      // Authorize by current group member (the creator).
      await User.collection.withRestrictedTags([group.tag, ...await Credentials.teamMembers(authorizedMember.tag, true)],
					       async () => {
						 await group.authorizeUser(u1);
						 await group.authorizeUser(u2);
					       });

      const groupKeyMembers = await Credentials.teamMembers(group.tag);
      expect(groupKeyMembers).toContain(authorizedMember.tag);
      expect(groupKeyMembers).toContain(u1.tag);
      expect(groupKeyMembers).toContain(u2.tag);      
      
      // Each use then adopts.
      await User.collection.withRestrictedTags([group.tag, ...await Credentials.teamMembers(u1.tag, true)],
					       () => u1.adoptGroup(group));
      await User.collection.withRestrictedTags([group.tag, ...await Credentials.teamMembers(u2.tag, true)],
					       () => u2.adoptGroup(group));

      expect(group.title).toBe("U.A., C., M.T.S.");

      await u1.destroy({prompt, answer});
      await u2.destroy({prompt, answer});
      await authorizedMember.destroyGroup(group);
    }, timeLimit(3));

    it("will fetch and cache a private non-existent group.", async function () {
      const dummy = await FairShareGroup.fetch('non-existent'); // You may learn of it later as a private group, and we want it functional.
      expect(dummy.users.length).toBe(0);
      expect(await dummy.title).toBe(''); // await is not needed within another rule, but out here it matters that title returns a promise.
      const dummy2 = await FairShareGroup.fetch('non-existent'); // Got cached on creation.
      expect(dummy2).toBe(dummy);
    });
    it("adds/removes user from group.", async function () {
      // Setup: create group and candidate user.
      const group = await authorizedMember.createGroup({title: 'group C'});
      await expectMember(authorizedMember.tag, group.tag,   {userTitle: 'user A', groupTitle: 'group C'});
      const candidate = await User.create({title: 'user C', secrets:[['q2', "y"]], deviceName, bankTag});
      await expectMember(candidate.tag, bankTag, {userTitle: 'user C', groupTitle: "First YZ Bank"});
      await expectMember(candidate.tag, group.tag,          {isMember: false, groupActor: authorizedMember.tag});

      // Add
      await FairShareGroup.collection.withRestrictedTags([authorizedMember.tag], () => group.authorizeUser(candidate)); // Not by candidate.
      await FairShareGroup.collection.withRestrictedTags(await Credentials.teamMembers(candidate.tag), () => candidate.adoptGroup(group));
      await expectMember(candidate.tag, group.tag, {userTitle: 'user C', groupTitle: 'group C', keyActor: authorizedMember.tag});
      await expectMember(candidate.tag, bankTag, {userTitle: 'user C', groupTitle: "First YZ Bank"});

      // Remove
      await group.deauthorizeUser(candidate); // By any current member.
      // Abandoning can only be the user who is abandoning.
      await FairShareGroup.collection.withRestrictedTags(await Credentials.teamMembers(candidate.tag), () => candidate.abandonGroup(group));
      await expectMember(candidate.tag, group.tag,          {userTitle: 'user C', isMember: false, groupActor: candidate.tag});

      // Cleanup. Destroy candidate.
      await candidate.destroy({prompt: 'q2', answer: "y"});
      await expectMember(candidate.tag, bankTag, {expectUserData: false, isMember: false, groupActor: candidate.tag});
      await expectNoKey(candidate.tag);
      // Cleanup. Destroy group. (Removes destroying user.)
      await authorizedMember.destroyGroup(group);
      await expectMember(authorizedMember.tag, group.tag,   {userTitle: 'user A', isMember: false, expectGroupData: false});
    }, timeLimit(2));

    it("has rate.", async function () {
      const defaultGroup = await authorizedMember.createGroup();
      let specifiedGroup = await authorizedMember.createGroup({rate: 0.01});
      let tag = specifiedGroup.tag;
      expect(defaultGroup.rate).toBe(0);
      expect(specifiedGroup.rate).toBe(0.01);

      specifiedGroup = await FairShareGroup.fetch(tag);
      expect(specifiedGroup.rate).toBe(0.01);

      await authorizedMember.destroyGroup(defaultGroup);
      await authorizedMember.destroyGroup(specifiedGroup);
    }, timeLimit(2));
    it("has stipend.", async function () {
      const defaultGroup = await authorizedMember.createGroup();
      let specifiedGroup = await authorizedMember.createGroup({stipend: 2});
      let tag = specifiedGroup.tag;
      expect(defaultGroup.stipend).toBe(0);
      expect(specifiedGroup.stipend).toBe(2);

      specifiedGroup = await FairShareGroup.fetch(tag);
      expect(specifiedGroup.stipend).toBe(2);

      await authorizedMember.destroyGroup(defaultGroup);
      await authorizedMember.destroyGroup(specifiedGroup);
    }, timeLimit(2));

    it("handles messages.", async function () {
      const group = await authorizedMember.createGroup({title: 'chat'});
      const prompt = 'p1', answer = "a1";
      const stranger = await User.create({title: 'user D', secrets:[[prompt, answer]], deviceName, bankTag}); // Not a member of group.

      await group.send({title: "Hello, world!"}, authorizedMember);
      await group.send({title: "Goodbye!", type: 'goodbye'}, stranger); // Can inject a message.
      await expectMessages(group, [
	{title: "Hello, world!", from: authorizedMember.title, of: group.title, type: 'text'},
	{title: "Goodbye!", from: stranger.title, of: group.title, type: 'goodbye'}
      ]);
      const fetched = await Message.collection.retrieve({tag: group.tag, member: null}); // Most recent message.
      expect(fetched.protectedHeader.cty).toContain('encrypted');

      await stranger.destroy({prompt, answer});
      await authorizedMember.destroyGroup(group);
      expectGone(Message.collection, group.tag);
    }, timeLimit(2));
  });

  describe("combined", function () {
    describe("non-member invitation", function () {
      let invitation, user, pairwiseChatTag, pairwiseChat;
      const prompt = 'q2', answer = "foo", deviceName = "something";
      const title = "I Am I";
      beforeAll(async function () {
	invitation = await authorizedMember.createInvitation();
	user = await User.claim({invitation, title, secrets: [[prompt, answer]], deviceName});
	pairwiseChatTag = user.groups.find(tag => ![user.tag, bankTag].includes(tag));
	pairwiseChat = await FairShareGroup.fetch(pairwiseChatTag);
      }, timeLimit(3));

      it("matches user tag.", function () {
	expect(invitation).toBe(user.tag);
      });
      it("cannot be claimed a second time.", async function () {
	expect(await User.claim({invitation, title, secrets: [[prompt, answer]], deviceName})
	       .catch(() => 'failed'))
	  .toBe('failed');
      });
      it("includes claimed secrets.", async function () {
	expect(user.secrets[prompt]).toBe(await Credentials.encodeBase64url(await Credentials.hashText(answer)));
      });
      it("includes claimed device.", async function () {
	expect(await Credentials.teamMembers(user.tag)).toContain(user.devices[deviceName]);
      });
      it("is member of sponsor's bank.", async function () {
	await expectMember(user.tag, bankTag, {userTitle: title, groupTitle: "First YZ Bank"});
      });
      it("has personal group.", async function () {
	await expectMember(user.tag, user.tag, {userTitle: title, groupTitle: null}); // Group does have a computed title ("Yourself"), but not in persisted public data.
      });
      it("has a pairwise chat with invitee and sponsor as members.", async function () {
	// Invitee and sponsor are members of a pairwiseChat, which was written by new user.
	await expectMember(user.tag, pairwiseChatTag, {userTitle: title, groupTitle: null});
	await expectMember(authorizedMember.tag, pairwiseChatTag, {userTitle: authorizedMember.title, groupTitle: null, groupActor: user.tag});
      });
      it("accepts messages from invitee and sponsor.", async function () {
	await pairwiseChat.send({title: 'welcome!'}, authorizedMember);
	await pairwiseChat.send({title: 'thanks for inviting me'}, user);
	await expectMessages(pairwiseChat, [
	  {title: "welcome!", from: authorizedMember.title, of: await pairwiseChat.title, type: 'text'},
	  {title: "thanks for inviting me", from: user.title, of: await pairwiseChat.title, type: 'text'}
	]);
      });

      afterAll(async function () {
	await user.destroy({prompt, answer, author: user, owner: user});
	await expectMember(user.tag, bankTag, {isMember: false, expectUserData: false});
	await expectMember(user.tag, pairwiseChatTag, {isMember: false, expectUserData: false, groupTitle: null});
	await expectMember(authorizedMember.tag, pairwiseChatTag, {userTitle: authorizedMember.title, groupTitle: null, groupActor: user.tag}); // still
      });
    });
    
    describe('dependency tracking', function () {
      let reference;
      class ReferencingObject {
	get personalGroup() { return FairShareGroup.fetch(authorizedMember.tag); } // No need to await - it is automatic!
	get personalTitle() { return this.personalGroup.title; }
	get userTitles() { return User.directory.map(user => user.title); }
      }
      Rule.rulify(ReferencingObject.prototype);
      beforeAll(async function () {
	// Make certain the personal group title is not set by some other test.
	const personalGroup = await FairShareGroup.fetch(authorizedMember.tag);
	personalGroup.title = undefined;
	reference = new ReferencingObject();
      });
      it("tracks changes to simple property.", async function () {
	// We're outside of a rule here, so we must await the reference to allow it to commpute through propogated promises.
	let initialTitle = await reference.personalTitle;
	expect(initialTitle).toBe("Yourself");
	reference.personalGroup.title = "testing"; // But now personalGroup has cached the non-promise value.
	expect(reference.personalTitle).toBe('testing');
	reference.personalGroup.title = initialTitle;
	expect(reference.personalTitle).toBe("Yourself");
      });
      it("tracks the live list.", async function () {
	expect(reference.userTitles).toEqual(['user A']);
	const another = await User.create({title: 'another', secrets:[['q0', 'x']], deviceName, bankTag});
	expect(reference.userTitles).toEqual(['user A', 'another']);
	await another.destroy({prompt: 'q0', answer: 'x'});
	expect(reference.userTitles).toEqual(['user A']);
      }, timeLimit(1));
    });

    describe("group operations", function () {
      let alice, bob, apples;
      const p = 'x', a = 'y';
      beforeAll(async function () {
	alice = await User.create({title: "Alice", secrets: [[p, a]], deviceName, bankTag});
	apples = await alice.createGroup({title: "Apples"});
	await expectMember(alice.tag, apples.tag, {userTitle: "Alice", groupTitle: "Apples"});
	bob = await User.create({title: "Bob", secrets: [[p, a]], deviceName, bankTag});
	await apples.authorizeUser(bob);
	await bob.adoptGroup(apples);
	await expectMember(bob.tag, apples.tag, {userTitle: "Bob", groupTitle: "Apples"});
      }, timeLimit(3));
      afterAll(async function () {
	await alice.destroy({prompt: p, answer: a});
	await bob.destroy({prompt: p, answer: a});
	await expectNoKey(alice.tag);
	await expectNoKey(bob.tag);
	await expectNoKey(apples.tag);
      });
      describe("rate", function () {
	let initialRate;
	beforeAll(function () {
	  apples.rate = undefined; // reset from transfer tests.
	  initialRate = apples.rate; // Before bob or alice have cast a vote
	});
	it("is zero with no votes.", function () {
	  expect(initialRate).toBe(0);
	});
	it("reflects vote changes.", function () {
	  apples.setVote(alice, 'rate', 0.01);
	  expect(apples.rate).toBe(0.01);
	  apples.setVote(bob, 'rate', 0.03);
	  expect(apples.rate).toBe(0.02);
	  apples.setVote(bob, 'rate', 0.07);
	  expect(apples.rate).toBe(0.04);
	});
	it("reflect user changes.", async function () {
	  apples.setVote(alice, 'rate', 0.01);
	  apples.setVote(bob, 'rate', 0.03);	  

	  const carol = await User.create({title: "Carol", secrets: [[p, a]], deviceName, bankTag});
	  await apples.authorizeUser(carol);
	  await carol.adoptGroup(apples);
	  apples.setVote(carol, 'rate', 0.05);
	  expect(apples.rate).toBe(0.03);

	  // console.log('PERSIST APPLES');
	  // await apples.persist(alice, apples, true);
	  // console.log('PERSISTED APPLES');
	  // apples.members.forEach(member => Member.directory.delete(member.tag));
	  // FairShareGroup.directory.delete(apples.tag);
	  // apples = await FairShareGroup.fetch(apples.tag, alice);
	  // expect(apples.rate).toBe(0.03);	  

	  await carol.abandonGroup(apples);
	  await apples.deauthorizeUser(carol);
	  expect(apples.rate).toBe(0.02);

	  apples.setVote(bob, 'rate', undefined);
	  await carol.destroy({prompt: p, answer: a});
	});
      });
      describe("stipend", function () {
	let initialStipend;
	beforeAll(function () {
	  apples.stipend = undefined; // reset from transfer tests.
	  initialStipend = apples.stipend; // Before bob or alice have cast a vote
	});
	it("is zero with no votes.", function () {
	  expect(initialStipend).toBe(0);
	});
	it("reflects vote changes.", function () {
	  apples.setVote(alice, 'stipend', 0.01);
	  expect(apples.stipend).toBe(0.01);
	  apples.setVote(bob, 'stipend', 0.03);
	  expect(apples.stipend).toBe(0.02);
	  apples.setVote(bob, 'stipend', 0.07);
	  expect(apples.stipend).toBe(0.04);
	});
	it("reflect user changes.", async function () {
	  apples.setVote(alice, 'stipend', 0.01);
	  apples.setVote(bob, 'stipend', 0.03);	  

	  const carol = await User.create({title: "Carol", secrets: [[p, a]], deviceName, bankTag});
	  await apples.authorizeUser(carol);
	  await carol.adoptGroup(apples);
	  apples.setVote(carol, 'stipend', 0.05);
	  expect(apples.stipend).toBe(0.03);

	  await carol.abandonGroup(apples);
	  await apples.deauthorizeUser(carol);
	  expect(apples.stipend).toBe(0.02);

	  apples.setVote(bob, 'stipend', undefined);
	  await carol.destroy({prompt: p, answer: a});
	});
      });      
      // TODO: burn to same group
      // TODO: mint from same group
      // TODO: to member of another group
      describe("transfer between members", function () {
	beforeAll(async function () {
	  apples.setSender(alice);
	  apples.setReceiver(bob);
	  apples.amount = 1;
	  const now = Date.now();
	  apples.tick = now + FairShareGroup.MILLISECONDS_PER_DAY;
	});
	it("zero stipend & stipend.", function () {
	  apples.rate = apples.stipend = 0;
	  expect(apples.senderBalance).toBe(-1);
	  expect(apples.receiverBalance).toBe(1);
	});	
	it("non-zero rate & stipend.", function () {
	  apples.rate = 0.01;
	  apples.stipend = 10;
	  expect(apples.senderBalance).toBe(10 - 1.01);
	  expect(apples.receiverBalance).toBe(10 + 1);
	});	
      });
    });
  });
});
