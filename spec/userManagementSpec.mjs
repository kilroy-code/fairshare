import { Credentials, MutableCollection } from '@kilroy-code/flexstore';
import { User, Group } from '../models.mjs';
const { describe, beforeAll, afterAll, it, expect, expectAsync } = globalThis;

function timeLimit(nKeysCreated = 1) { // Time to create a key set varies quite a bit (deliberately).
  return (nKeysCreated * 4e3) + 3e3;
}
 
describe("User management", function () {
  let authorizedMember, commonGroup, originalCommunityGroup = Group.communityTag;

  // Reusable assertions for our testing.
  async function expectNoKey(tag) { // Confirm that tag does not exist as a key.
    expect(await Credentials.collections.Team.retrieve(tag)).toBeFalsy();
    expect(await Credentials.collections.EncryptionKey.retrieve(tag)).toBeFalsy();
  }
  async function expectMember(userTag, groupTag, {
    expectUserData = true, userTitle = '',
    isMember = true, groupActor = userTag, expectGroupData = true, groupTitle = ''
  } = {}) {
    // Confirm properties for user being a member of group.

    const userData = await User.retrieve(userTag);                    // User data.
    if (expectUserData) {
      expect(userData.protectedHeader.kid).toBe(userTag);             // Signed by one Key IDentifer.
      if (isMember) expect(userData.json.groups).toContain(groupTag); // User's groups list includes the specified group.
      else expect(userData.json.groups).not.toContain(groupTag);
      if (userTitle) expect(userData.json.title).toBe(userTitle);
    } else {
      expect(userData).toBeFalsy();
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
      if (groupTitle) expect(groupData.json.title).toBe(groupTitle);
    } else {
      expect(groupData).toBeFalsy();
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
    commonGroup = Group.communityTag = await Credentials.create(bootstrapUserTag);
    await Group.store(Group.assign({title: 'group A'}),    {tag: commonGroup,      owner: commonGroup,      author: bootstrapUserTag});
    //await messages.store('start commonGroup', {tag: commonGroup, owner: commonGroup, author: bootstrapUserTag});
    
    authorizedMember = await User.create({title: 'user A', prompt: 'q0', answer: "17"});
    await Credentials.changeMembership({tag: commonGroup, remove: [bootstrapUserTag]});
    await Credentials.destroy(bootstrapUserTag);

    // Check our starting conditions.
    await expectMember(bootstrapUserTag, commonGroup, {isMember: false, expectUserData: false, groupActor: authorizedMember});
    await expectMember(authorizedMember, commonGroup, {userTitle: 'user A', groupTitle: 'group A'});
    await expectNoKey(bootstrapUserTag);
  }, timeLimit(3)); // Key creation is deliberately slow.

  afterAll(async function () { // Remove everything we have created. (But not whole collections as this may be "live".)
    // Same dance as in creation.
    const bootstrapUserTag = await Credentials.create(); // No user object.
    await Credentials.changeMembership({tag: commonGroup, add: [bootstrapUserTag]});

    await User.destroy(authorizedMember);
    expect(await User.retrieve(commonGroup)).toBeFalsy();    
    await expectNoKey(authorizedMember);
    
    await Group.collection.remove({tag: commonGroup, owner: commonGroup, author: bootstrapUserTag});
    expect(await Group.retrieve(commonGroup)).toBeFalsy();
    await Credentials.destroy(commonGroup);
    await expectNoKey(commonGroup);
    await Credentials.destroy(bootstrapUserTag);
    await expectNoKey(bootstrapUserTag);

    Group.communityTag = originalCommunityGroup; // Restore in case anything shared with live data.
  }, timeLimit(1));

  it("creates/destroys user.", async function () {
    const userTag = await User.create({title: 'user B', prompt: 'q1', answer: "42"});
    await expectMember(userTag, Group.communityTag, {userTitle: 'user B', groupTitle: 'group A'});

    await User.destroy(userTag);
    await expectMember(userTag, Group.communityTag, {isMember: false, expectUserData: false});
    await expectNoKey(userTag);
  }, timeLimit(1));

  it("creates/destroys group.", async function () {
    const groupTag = await Group.create({title: 'group B', author: authorizedMember});
    await expectMember(authorizedMember, groupTag, {userTitle: 'user A', groupTitle: 'group B'});

    await Group.destroy(groupTag, authorizedMember);
    await expectMember(authorizedMember, groupTag, {isMember: false, expectGroupData: false, userTitle: 'user A'});
  }, timeLimit(1));

  it("adds/removes user from group.", async function () {
    // Setup: create group and candidate user.
    const groupTag = await Group.create({title: 'group C', author: authorizedMember});
    await expectMember(authorizedMember, groupTag, {userTitle: 'user A', groupTitle: 'group C'});
    const candidate = await User.create({title: 'user C', prompt: 'q2', answer: "y"});
    await expectMember(candidate, Group.communityTag, {userTitle: 'user C', groupTitle: 'group A'});
    await expectMember(candidate, groupTag, {isMember: false, groupActor: authorizedMember});
    
    await Group.authorizeUser(groupTag, candidate);
    await User.adoptGroup(candidate, groupTag);
    await expectMember(candidate, groupTag, {keyActor: authorizedMember, userTitle: 'user C', groupTitle: 'group C'});
    await expectMember(candidate, Group.communityTag, {userTitle: 'user C', groupTitle: 'group A'});

    await Group.deauthorizeUser(groupTag, candidate);    
    await User.abandonGroup(candidate, groupTag);
    await expectMember(candidate, groupTag, {isMember: false, groupActor: candidate, userTitle: 'user C'});

    await User.destroy(candidate);
    await expectNoKey(candidate);
    await Group.destroy(groupTag, authorizedMember);
    await expectMember(authorizedMember, groupTag, {isMember: false, expectGroupData: false, userTitle: 'user A'});
  }, timeLimit(2));
});
