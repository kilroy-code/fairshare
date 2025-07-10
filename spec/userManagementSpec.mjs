import { Credentials, MutableCollection } from '@kilroy-code/flexstore';
import { Rule } from '@kilroy-code/rules';
import { User, Group } from '../models.mjs';
const { describe, beforeAll, afterAll, it, expect, expectAsync } = globalThis;

function timeLimit(nKeysCreated = 1) { // Time to create a key set varies quite a bit (deliberately).
  return (nKeysCreated * 6e3) + 4e3;
}
 
describe("Model management", function () {
  let authorizedMember, authorizedMemberTag, originalCommunityGroup = Group.communityTag;

  // Reusable assertions for our testing.
  async function expectGone(kind, tag) { // get, so as not to get false negative if present but not valid.
    expect(await kind.get(tag)).toBeFalsy();
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

    const userData = await User.retrieve(userTag);                    // User data.
    if (expectUserData) {
      expect(userData.protectedHeader.kid).toBe(userTag);             // Signed by one Key IDentifer.
      if (isMember) expect(userData.json.groups).toContain(groupTag); // User's groups list includes the specified group.
      else expect(userData.json.groups).not.toContain(groupTag);
      if (userTitle) expect(userData.json.title).toBe(userTitle);
    } else {
      expect(userData).toBeFalsy();
      expect(await User.privateCollection.get(userTag)).toBeFalsy();
    }

    // Get data regardless of whether user is a member of team, as that is checked below.
    const groupData = await Group.retrieve({tag: groupTag, member: null});  // Group Data
    if (expectGroupData) {
      expect(groupData.protectedHeader.iss).toBe(groupTag);                   // Signed by the group itself (ISSuer).
      expect(groupData.protectedHeader.act).toBe(groupActor);                 // Signed by a then-current member (ACTor).
      if (isMember) {
	expect(groupData.json.users).toContain(userTag);                      // Group's user data list includes the specified user.
      } else {
	expect(groupData.json.users).not.toContain(userTag);
      }
      if (groupTitle) {
	expect(groupData.json.title).toBe(groupTitle);
      }
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
    
    authorizedMember = await User.create({title: 'user A', prompt: 'q0', answer: "17"});
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
    await expectGone(Group.collection, Group.communityTag);
    await expectGone(Group.privateCollection, Group.communityTag);
    await Credentials.destroy(Group.communityTag);
    await expectNoKey(Group.communityTag);
    await Credentials.destroy(bootstrapUserTag);
    await expectNoKey(bootstrapUserTag);

    Group.communityTag = originalCommunityGroup; // Restore in case anything shared with live data.
  }, timeLimit(1));

  it("creates/destroys user.", async function () {
    const user = await User.create({title: 'user B', prompt: 'q1', answer: "42"});
    await expectMember(user.tag, Group.communityTag, {userTitle: 'user B', groupTitle: 'group A'});

    await user.destroy({prompt: 'q1', answer: "42"});
    await expectMember(user.tag, Group.communityTag, {isMember: false, expectUserData: false});
    await expectNoKey(user.tag);
  }, timeLimit(1));

  it("creates/destroys group.", async function () {
    const group = await authorizedMember.createGroup({title: 'group B'});
    await expectMember(authorizedMember.tag, group.tag, {userTitle: 'user A', groupTitle: 'group B'});

    await authorizedMember.destroyGroup(group);
    await expectMember(authorizedMember.tag, group.tag, {isMember: false, expectGroupData: false, userTitle: 'user A'});
  }, timeLimit(1));

  it("adds/removes user from group.", async function () {
    // Setup: create group and candidate user.
    const group = await authorizedMember.createGroup({title: 'group C'});
    await expectMember(authorizedMember.tag, group.tag, {userTitle: 'user A', groupTitle: 'group C'});
    const candidate = await User.create({title: 'user C', prompt: 'q2', answer: "y"});
    await expectMember(candidate.tag, Group.communityTag, {userTitle: 'user C', groupTitle: 'group A'});
    await expectMember(candidate.tag, group.tag, {isMember: false, groupActor: authorizedMember.tag});
    
    await group.authorizeUser(candidate);
    await candidate.adoptGroup(group);
    await expectMember(candidate.tag, group.tag, {keyActor: authorizedMember.tag, userTitle: 'user C', groupTitle: 'group C'});
    await expectMember(candidate.tag, Group.communityTag, {userTitle: 'user C', groupTitle: 'group A'});

    await group.deauthorizeUser(candidate);
    await candidate.abandonGroup(group);
    await expectMember(candidate.tag, group.tag, {isMember: false, groupActor: candidate.tag, userTitle: 'user C'});

    await candidate.destroy({prompt: 'q2', answer: "y"});
    await expectNoKey(candidate.tag);
    await authorizedMember.destroyGroup(group);
    await expectMember(authorizedMember.tag, group.tag, {isMember: false, expectGroupData: false, userTitle: 'user A'});
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
      const another = await User.create({title: 'another', prompt: 'q0', answer: 'x'});
      expect(reference.userTitles).toEqual(['user A', 'another']);
      await another.destroy({prompt: 'q0', answer: 'x'});
      expect(reference.userTitles).toEqual(['user A']);
    }, timeLimit(1));
  });
});
