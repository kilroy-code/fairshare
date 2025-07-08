import { Credentials, MutableCollection } from '@kilroy-code/flexstore';

class FairshareModel {
  static get collection() { return this._collection ??= new MutableCollection({name: this.name}); }
  static retrieve(options) { return this.collection.retrieve(options); }
  static store(data, options) { return this.collection.store(data, options); }
}

export class User extends FairshareModel {
  static empty = {groups: []};
  static async create(/*fixme prompt, etc.*/) { // Promises tag, not User object
    const userTag = await Credentials.create();
    const groupTag = Group.communityTag;
    const communityGroup = await Group.retrieve({tag: groupTag, member: null}); // Could have last been written by someone no longer in the group.
    await Group.authorizeUser(groupTag, userTag);
    await User._adoptGroup(userTag, groupTag, {json: this.empty}, communityGroup);
    return userTag;
  }
  static async destroy(userTag) {
    const tag = userTag;
    await User.abandonGroup(userTag, Group.communityTag);
    await Group.deauthorizeUser(Group.communityTag, userTag);
    await this.collection.remove({tag, owner: userTag, author: userTag});
    await Credentials.destroy(userTag, {resursive: true});
  }
  static async adoptGroup(userTag, groupTag) {
    // Used by a previously authorized user to add themselves to a group,
    // changing both the group data and the user's own list of groups.
    const [user, group] = await Promise.all([User.retrieve(userTag), Group.retrieve({tag: groupTag, member: null})]);
    return await this._adoptGroup(userTag, groupTag, user, group);
  }
  static async _adoptGroup(userTag, groupTag, user, group) {
    user.json.groups = [...user.json.groups, groupTag];
    group.json.users = [...group.json.users , userTag];
    return Promise.all([
      User.store( user.json,  {tag: userTag,  owner: userTag,  author: userTag}),
      Group.store(group.json, {tag: groupTag, owner: groupTag, author: userTag})
    ]);
  }
  static async abandonGroup(userTag, groupTag) {
    // Used by user to remove a group from their own user data.
    const user = await User.retrieve(userTag);
    user.json.groups = user.json.groups.filter(tag => tag !== groupTag);
    return await User.store(user.json, {tag: userTag, owner: userTag, author: userTag});
  }
}

export class Group extends FairshareModel {
  static communityTag = null; // The tag of the Group of which everyone is a member. Must be set by application.
  static empty = {users: []};
  static async create(userTag) { // Promises tag, not the group itself.
    // Create group with user as member.
    const groupTag = await Credentials.create(userTag); // userTag is authorized for newly create groupTag.
    await User._adoptGroup(userTag, groupTag, await User.retrieve(userTag), {json: this.empty});
    return groupTag;
  }
  static async destroy(groupTag, userTag) {
    // Used by last group member to destroy a group.
    // TODO? Check that we are last?
    const tag = groupTag;
    await this.collection.remove({tag, owner: tag, author: userTag});
    await User.abandonGroup(userTag, groupTag);
    await Credentials.destroy(groupTag);
  }
  static authorizeUser(groupTag, candidateTag) {
    // Used by an existing member to add someone to the group's key
    // so that the candidate can then adoptGroup.
    const tag = groupTag;
    return Credentials.changeMembership({tag, add: [candidateTag]});
  }
  static async deauthorizeUser(groupTag, userTag, author = userTag) {
    // Used by any team member (including the user) to remove user from the group and its key.
    // Does NOT change the user's data.
    const tag = groupTag;
    const group = await this.retrieve({tag, member: null});
    group.json.users = group.json.users.filter(tag => tag !== userTag);
    await this.store(group.json, {tag, owner: tag, author});
    await Credentials.changeMembership({tag, remove: [userTag]});
  }
}

// TODO
// message
// edit user
// edit group
// pay user
// is voting an edit group operation? a message operation?
// request join
// invite non-member
// encryption/decryption
// live objects
// title/picture
// dependency tracking
