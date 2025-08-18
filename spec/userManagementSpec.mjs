import { Credentials, MutableCollection } from '@kilroy-code/flexstore';
import { Rule } from '@kilroy-code/rules';
import { User, Group, Message } from '../models.mjs';
const { describe, beforeAll, afterAll, it, expect, expectAsync } = globalThis;

Object.assign(globalThis, {User, Group, Message, Credentials}); // for debugging in browser

function timeLimit(nKeysCreated = 1) { // Time to create a key set varies quite a bit (deliberately).
  return (nKeysCreated * 6e3) + 6e3;
}

describe("Model management", function () {
  let authorizedMember,
      deviceName = 'test',
      originalCommunityGroup = Group.communityTag;

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
    isMember = true, groupActor = userTag, expectGroupData = true, groupTitle = ''
  } = {}) {
    // Confirm properties for user being a member of group.
    // This is reaching under the hood to the level of persisted artifacts.
    const userData = await User.collection.retrieve(userTag);               // User data.
    const userPrivateData = await User.privateCollection.retrieve(userTag);
    if (expectUserData) {
      if (userTitle === null) {
	expect(userData).toBeFalsy();
      } else {
	expect(userData.protectedHeader.kid).toBe(userTag);                    // Signed by one Key IDentifer.
	if (userTitle) expect(userData.json.title).toBe(userTitle);
      }
      expect(userPrivateData.protectedHeader.kid).toBe(userTag);
      expect(userPrivateData.protectedHeader.cty).toContain('encrypted');
      expect(userPrivateData.decrypted.protectedHeader.kid).toBe(userTag);
      if (isMember) expect(userPrivateData.json.groups).toContain(groupTag); // User's groups list includes the specified group.
      else expect(userPrivateData.json.groups).not.toContain(groupTag);
    } else {
      expect(userPrivateData).toBeFalsy();
    }

    // Get data regardless of whether user is a member of team, as that is checked below.
    const groupData = await Group.collection.retrieve({tag: groupTag, member: null});  // Group Data
    const groupPrivateData = await Group.privateCollection.retrieve({tag: groupTag, member: null});
    if (expectGroupData) {
      if (groupTitle === null) {
	expect(groupData).toBeFalsy();
      } else {
	const {kid:ukid, iss:uowner = ukid, act:uauthor = ukid} = groupData.protectedHeader;
	expect(uowner || ukid).toBe(groupTag);                   // Signed by the group itself (ISSuer).
	if (groupActor) expect(uauthor).toBe(groupActor);                 // Signed by a then-current member (ACTor).
	if (groupTitle) expect(groupData.json.title).toBe(groupTitle);
      }
      const {kid:vkid, iss:vowner = vkid, act:vauthor = vkid} = groupPrivateData.protectedHeader;
      expect(vowner || vkid).toBe(groupTag);
      if (groupActor) expect(vauthor).toBe(groupActor);
      expect(groupPrivateData.protectedHeader.cty).toContain('encrypted');
      expect(groupPrivateData.decrypted.protectedHeader.kid).toBe(groupTag);
      if (isMember) expect(groupPrivateData.json.users).toContain(userTag);   // Group's user data list includes the specified user.
      else expect(groupPrivateData.json.users).not.toContain(userTag);
    } else {
      expect(groupData).toBeFalsy();
      expect(await Group.privateCollection.get(groupTag)).toBeFalsy();
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

  beforeAll(async function () {
    // Bootstrap community group using temporary user credentials.
    const bootstrapUserTag = await Credentials.create(); // No user object.
    Group.communityTag = await Credentials.create(bootstrapUserTag);
    const group = new Group({title: 'group A', tag: Group.communityTag});
    await group.persist({tag:bootstrapUserTag}); // Pun: {tag} looks like a store option, but it's actually a fake User with a tag property.
    // Using the bootstrap users, construct a real authorized member of the community group.
    authorizedMember = await User.create({title: 'user A', secrets:[['q0', "17"]], deviceName});
    await Credentials.changeMembership({tag: Group.communityTag, remove: [bootstrapUserTag]});
    await Credentials.destroy(bootstrapUserTag);

    // Check our starting conditions.
    await expectMember(bootstrapUserTag, Group.communityTag, {isMember: false, expectUserData: false, groupActor: authorizedMember.tag});
    await expectMember(authorizedMember.tag, Group.communityTag, {userTitle: 'user A', groupTitle: 'group A'});
    await expectNoKey(bootstrapUserTag);
  }, timeLimit(3)); // Key creation is deliberately slow.

  afterAll(async function () { // Remove everything we have created. (But not whole collections as this may be "live".)
    // Same dance as in creation.
    const bootstrapUserTag = await Credentials.create(); // No user object.
    await Credentials.changeMembership({tag: Group.communityTag, add: [bootstrapUserTag]});

    await authorizedMember.destroy({prompt: 'q0', answer: "17"});
    await expectGone(User.collection, authorizedMember.tag);
    await expectGone(User.privateCollection, authorizedMember.tag);
    await expectNoKey(authorizedMember.tag);
    
    await Group.collection.remove({tag: Group.communityTag, owner: Group.communityTag, author: bootstrapUserTag});
    await Group.privateCollection.remove({tag: Group.communityTag, owner: Group.communityTag, author: bootstrapUserTag});
    await expectGone(Group.collection, Group.communityTag);
    await expectGone(Group.privateCollection, Group.communityTag);
    await Credentials.destroy(Group.communityTag);
    await expectNoKey(Group.communityTag);
    await Credentials.destroy(bootstrapUserTag);
    await expectNoKey(bootstrapUserTag);

    Group.communityTag = originalCommunityGroup; // Restore in case anything shared with live data.
  }, timeLimit(1));

  // TODO: try these with bad credentials. Make sure it doesn't leave stuff in a weird stae.

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
      const u1 = await User.create({title: "Yours truly", secrets:[[prompt, answer]], deviceName});
      const u2 = await User.create({title: "milton bradley", secrets:[[prompt, answer]], deviceName});

      // Authorize by current group member (the creator).
      await User.collection.withRestrictedTags(await Credentials.teamMembers(authorizedMember.tag, true),
					       () => Promise.all([group.authorizeUser(u1), group.authorizeUser(u2)]));

      // Each use then adopts.
      await User.collection.withRestrictedTags(await Credentials.teamMembers(u1.tag, true),
					       () => u1.adoptGroup(group));
      await User.collection.withRestrictedTags(await Credentials.teamMembers(u2.tag, true),
					       () => u2.adoptGroup(group));

      expect(group.title).toBe("U.A., Y.T., M.B.");

      await u1.destroy({prompt, answer});
      await u2.destroy({prompt, answer});
      await authorizedMember.destroyGroup(group);
    }, timeLimit(3));

    it("will fetch and cache a private non-existent group.", async function () {
      const dummy = await Group.fetch('non-existent'); // You may learn of it later as a private group, and we want it functional.
      expect(dummy.users.length).toBe(0);
      expect(await dummy.title).toBe(''); // await is not needed within another rule, but out here it matters that title returns a promise.
      const dummy2 = await Group.fetch('non-existent'); // Got cached on creation.
      expect(dummy2).toBe(dummy);
    });
  });

  describe("created user", function () {
    let user;
    beforeAll(async function () {
      user = await User.create({title: 'user B', secrets:[['q1', "42"]], deviceName});
    }, timeLimit(1));

    it("has community group.", async function () {
      await expectMember(user.tag, Group.communityTag, {userTitle: 'user B', groupTitle: 'group A', groupActor: null});
    });
    it("has personal group.", async function () {
      await expectMember(user.tag, user.tag,           {userTitle: 'user B', groupTitle: null});

      expect(await Group.collection.list()).not.toContain(user.tag); // Not listed in persistent data.
      expect(Group.directory.has(user.tag)).toBeTruthy(); // In session where instance was made or fetched.

      const group = await Group.fetch(user.tag); // Works because of previous line.
      expect(group.title).toBe("Yourself");      // From rule, not from persisted data.
      expect(group.users).toEqual([user.tag]);
      expect(user.groups).toContain(group.tag);

      // Simulate a new session.
      Group.directory.delete(user.tag);
      Group.privateDirectory.delete(user.tag);
      let fetched = await Group.fetch(user.tag);
      expect(fetched).not.toBe(group);   // A new (empty) Group instance.
      expect(fetched.users).toEqual([]); // Because it has not fetched private data.

      let personal = await Group.fetchPrivate(user.tag); // The normal, later-session-compatible way to get private Groups.
      expect(personal.users).toEqual([user.tag]);
      expect(user.groups).toContain(personal.tag);
      expect(personal).toBe(fetched); // The privateFetch updated the previous fetch result!

      // Now repeat in the other order.
      Group.directory.delete(user.tag);
      Group.privateDirectory.delete(user.tag);
      personal = await Group.fetchPrivate(user.tag);
      fetched = await Group.fetch(user.tag);
      expect(personal).toBe(fetched);
      expect(personal.users).toEqual([user.tag]);
      expect(user.groups).toContain(personal.tag);
    });

    it("can edit public and private data.", async function () {
      const {tag, picture, groups, devices} = user;        // Private data before editing.

      await user.edit({picture: "foo bar"});           // Change public data.
      expect(user.picture).toBe("foo bar");            // In object.
      const verified1 = await User.collection.retrieve(tag);
      const verified2 = await User.privateCollection.retrieve(tag);
      expect(verified1.json.picture).toBe("foo bar"); // Persisted
      expect(user.title).toBe('user B');               // Other public data unchanged.
      expect(verified1.json.title).toBe('user B');
      expect(user.groups).toBe(groups);                // Private data unchanged.
      expect(verified2.json.groups).toEqual(groups);

      devices['foo'] = 'bar';                            // Change private data.
      await user.edit({devices});
      expect(user.devices['foo']).toBe('bar');            // In object
      const verified3 = await User.collection.retrieve(tag);
      const verified4 = await User.privateCollection.retrieve(tag);
      expect(verified4.json.devices['foo']).toBe('bar');  // Persisted
      expect(user.groups).toBe(groups);                   // Other private data unchanged.
      expect(verified4.json.groups).toEqual(groups);     
      expect(user.title).toBe('user B');                  // Public data unchanged.
      expect(verified3.json.title).toBe('user B');
      
      delete devices['foo'];                              // Restore
      await user.edit({devices, picture});
    });

    it("updates public and private data.", async function () {
      const tag = user.tag;
      const verified1 = await User.collection.retrieve(tag);
      const verified2 = await User.privateCollection.retrieve({tag, decrypt: false});

      // Make another user to model some different data from.
      const prompt = 'q1', answer = 'a1';
      const other = await User.create({title: 'fred', secrets:[[prompt, answer]], deviceName: 'something else'});
      const verified3 = await User.collection.retrieve(other.tag);
      const verified4 = await User.privateCollection.retrieve({tag: other.tag, decrypt: false});

      await User.update(tag, verified3);
      await User.updatePrivate(tag, verified4);
      await other.destroy({prompt, answer}); // verified4 was encrypted for other.tag, so we had to keep this around long enough to decrypt.
      expect(user.title).toBe('fred');
      expect(user.devices['something else']).toBeTruthy();

      // Restore
      await User.update(tag, verified1);
      await User.updatePrivate(tag, verified2);
      expect(await User.fetch(tag)).toBe(user);
      expect(user.title).toBe('user B');
      expect(user.devices['something else']).toBeFalsy();
    }, timeLimit(1));

    afterAll(async function () {
      await user.destroy({prompt: 'q1', answer: "42"});
      // Removes user from personal and community groups.
      await expectMember(user.tag, user.tag,           {isMember: false, expectUserData: false, expectGroupData: false});
      await expectMember(user.tag, Group.communityTag, {isMember: false, expectUserData: false});
      await expectNoKey(user.tag);
    });    
  });

  it("authorizes/deauthorizes existing user.", async function () {
    const prompt = 'q1', answer = "17", deviceName = "E's device";
    const user = await User.create({title: 'user E', secrets:[[prompt, answer]], deviceName});

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
    await expectMember(user.tag, Group.communityTag, {isMember: false, expectUserData: false});
  }, timeLimit(1));

  it("adds/removes user from group.", async function () {
    // Setup: create group and candidate user.
    const group = await authorizedMember.createGroup({title: 'group C'});
    await expectMember(authorizedMember.tag, group.tag,   {userTitle: 'user A', groupTitle: 'group C'});
    const candidate = await User.create({title: 'user C', secrets:[['q2', "y"]], deviceName});
    await expectMember(candidate.tag, Group.communityTag, {userTitle: 'user C', groupTitle: 'group A'});
    await expectMember(candidate.tag, group.tag,          {isMember: false, groupActor: authorizedMember.tag});

    // Add
    await group.authorizeUser(candidate);
    await candidate.adoptGroup(group);
    await expectMember(candidate.tag, group.tag,          {userTitle: 'user C', groupTitle: 'group C', keyActor: authorizedMember.tag});
    await expectMember(candidate.tag, Group.communityTag, {userTitle: 'user C', groupTitle: 'group A'});

    // Remove
    await group.deauthorizeUser(candidate);
    await candidate.abandonGroup(group);
    await expectMember(candidate.tag, group.tag,          {userTitle: 'user C', isMember: false, groupActor: candidate.tag});

    // Cleanup. Destroy candidate. (Removes from community group.)
    await candidate.destroy({prompt: 'q2', answer: "y"});
    await expectMember(candidate.tag, Group.communityTag, {expectUserData: false, isMember: false, groupActor: candidate.tag});
    await expectNoKey(candidate.tag);
    // Cleanup. Destroy group. (Removes destroying user.)
    await authorizedMember.destroyGroup(group);
    await expectMember(authorizedMember.tag, group.tag,   {userTitle: 'user A', isMember: false, expectGroupData: false});
  }, timeLimit(2));

  it("handles messages.", async function () {
    const group = await authorizedMember.createGroup({title: 'chat'});
    const prompt = 'p1', answer = "a1";
    const stranger = await User.create({title: 'user D', secrets:[[prompt, answer]], deviceName}); // Not a member of group.
    await group.send({title: "Hello, world!"}, authorizedMember);
    await group.send({title: "Goodbye!", type: 'goodbye'}, stranger); // Can inject a message.
    let messages = group.messages.map(m => ({title:m.title, from:m.author.title, in:m.owner.title, type:m.type}));
    expect(messages).toEqual([
      {title: "Hello, world!", from: authorizedMember.title, in: group.title, type: 'text'},
      {title: "Goodbye!", from: stranger.title, in: group.title, type: 'goodbye'}
    ]);
    const fetched = await Message.collection.retrieve(group.tag); // Most recent message.
    expect(fetched.protectedHeader.cty).toContain('encrypted');
    await stranger.destroy({prompt, answer});
    await authorizedMember.destroyGroup(group);
    expectGone(Message.collection, group.tag);
  }, timeLimit(2));

  describe('dependency tracking', function () {
    let reference;
    class ReferencingObject {
      get communityGroup() { return Group.fetch(Group.communityTag); } // No need to await - it is automatic!
      get communityTitle() { return this.communityGroup.title; }
      get userTitles() { return User.directory.map(user => user.title); }
    }
    Rule.rulify(ReferencingObject.prototype);
    beforeAll(function () { reference = new ReferencingObject(); });
    it("tracks changes to simple property.", async function () {
      // We're outside of a rule here, so we must await the reference to allow it to commpute through propogated promises.
      let initialTitle = await reference.communityTitle;
      expect(initialTitle).toBe('group A');
      reference.communityGroup.title = 'FairShare'; // But now communityGroup has cached the non-promise value.
      expect(reference.communityTitle).toBe('FairShare');
      reference.communityGroup.title = initialTitle;
      expect(reference.communityTitle).toBe('group A');
    });
    it("tracks the live list.", async function () {
      expect(reference.userTitles).toEqual(['user A']);
      const another = await User.create({title: 'another', secrets:[['q0', 'x']], deviceName});
      expect(reference.userTitles).toEqual(['user A', 'another']);
      await another.destroy({prompt: 'q0', answer: 'x'});
      expect(reference.userTitles).toEqual(['user A']);
    }, timeLimit(1));
  });
});
