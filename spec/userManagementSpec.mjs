import { Credentials, MutableCollection } from '@kilroy-code/flexstore';
import { Rule } from '@kilroy-code/rules';
import { User, Group } from '../models.mjs';
const { describe, beforeAll, afterAll, it, expect, expectAsync } = globalThis;

function timeLimit(nKeysCreated = 1) { // Time to create a key set varies quite a bit (deliberately).
  return (nKeysCreated * 6e3) + 5e3;
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
      expect(userData.protectedHeader.kid).toBe(userTag);                    // Signed by one Key IDentifer.
      expect(userPrivateData.protectedHeader.kid).toBe(userTag);
      // FIXME: confirm private is encrypted.
      if (isMember) expect(userPrivateData.json.groups).toContain(groupTag); // User's groups list includes the specified group.
      else expect(userPrivateData.json.groups).not.toContain(groupTag);

      if (userTitle) expect(userData.json.title).toBe(userTitle);
    } else {
      expect(userData).toBeFalsy();
      expect(userPrivateData).toBeFalsy();
    }

    // Get data regardless of whether user is a member of team, as that is checked below.
    const groupData = await Group.collection.retrieve({tag: groupTag, member: null});  // Group Data
    const groupPrivateData = await Group.privateCollection.retrieve({tag: groupTag, member: null});
    if (expectGroupData) {
      expect(groupData.protectedHeader.iss).toBe(groupTag);                   // Signed by the group itself (ISSuer).
      expect(groupData.protectedHeader.act).toBe(groupActor);                 // Signed by a then-current member (ACTor).
      expect(groupPrivateData.protectedHeader.iss).toBe(groupTag);
      expect(groupPrivateData.protectedHeader.act).toBe(groupActor);
      // FIXME: confirm private is encrypted.
      if (isMember) expect(groupPrivateData.json.users).toContain(userTag);   // Group's user data list includes the specified user.
      else expect(groupPrivateData.json.users).not.toContain(userTag);

      if (groupTitle) expect(groupData.json.title).toBe(groupTitle);
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
      if (isMember) {
	expect(keyData.json.recipients.some(recipient => recipient.header.kid === userTag)).toBeTruthy(); // User can decode group key.
      } else {
	expect(keyData.json.recipients.some(recipient => recipient.header.kid === userTag)).toBeFalsy();
      }
    } else {
      expect(keyData).toBeFalsy();
    }
  }

  beforeAll(async function () {
    // Bootstrap community group with temporary user credentials.
    const bootstrapUserTag = await Credentials.create(); // No user object.
    Group.communityTag = await Credentials.create(bootstrapUserTag);
    const group = new Group({title: 'group A', tag: Group.communityTag});
    await group.persist({tag:bootstrapUserTag}); // Pun: {tag} looks like a store option, but it's actually a fake User with a tag property.
    //await messages.store('start groupTag', {tag: groupTag, owner: groupTag, author: bootstrapUserTag});
    
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
  it("can edit one's own public and private data.", async function () {
    const groups = authorizedMember.groups;            // Private data before editing.
    await authorizedMember.edit({picture: "foo bar"}); // Change public data.
    expect(authorizedMember.title).toBe('user A');     // Other public data unchanged.
    const {devices} = authorizedMember;
    devices['foo'] = 'bar';                            // Change private data.
    await authorizedMember.edit({devices});
    expect(authorizedMember.groups).toBe(groups);      // Other private data unchanged.
    delete devices['foo'];                             // Restore
    await authorizedMember.edit({devices});
  });
  it("creates/destroys user.", async function () {
    // Adds user to community group.
    const user = await User.create({title: 'user B', secrets:[['q1', "42"]], deviceName});
    await expectMember(user.tag, Group.communityTag, {userTitle: 'user B', groupTitle: 'group A'});

    // Removes user from community group.
    await user.destroy({prompt: 'q1', answer: "42"});
    await expectMember(user.tag, Group.communityTag, {isMember: false, expectUserData: false});
    await expectNoKey(user.tag);
  }, timeLimit(1));

  it("authorizes/deauthorizes existing user.", async function () {
    const prompt = 'q1', answer = "17", deviceName = "E's device";
    const user = await User.create({title: 'user E', secrets:[[prompt, answer]], deviceName});

    console.log({prompt, answer, secrets: user.secrets, hash: await Credentials.hashText(answer)});
    expect(await user.preConfirmOwnership({prompt, answer})).toBeTruthy();
    expect(await user.preConfirmOwnership({prompt, answer: answer+'x'})).toBeFalsy();

    const removed = await user.deauthorize({prompt, answer, deviceName});
    expectGone(Credentials.collections.EncryptionKey, removed); // Device gone, too, but we don't get to see those.
    // This causes "Attempting access..." to be logged twice. (Once for public and once for private user collection item.)
    expect(await user.edit({picture: 'wrong'}).catch(() =>'rejected')).toBe('rejected');

    await user.authorize({prompt, answer, deviceName});
    await user.edit({picture: 'after re-authorization'}); // Now editable.
    expect(user.picture).toBe('after re-authorization');

    await user.destroy({prompt, answer});                 // And destroyable.
    await expectMember(user.tag, Group.communityTag, {isMember: false, expectUserData: false});
  }, timeLimit(1));

  it("creates/destroys group.", async function () {
    // Group has user as member.
    const group = await authorizedMember.createGroup({title: 'group B'});
    await expectMember(authorizedMember.tag, group.tag, {userTitle: 'user A', groupTitle: 'group B'});

    // Destroy removes the member.
    await authorizedMember.destroyGroup(group);
    await expectMember(authorizedMember.tag, group.tag, {isMember: false, expectGroupData: false, userTitle: 'user A'});
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
