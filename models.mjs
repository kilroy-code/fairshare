import { Credentials, MutableCollection } from '@kilroy-code/flexstore';

class FairshareModel {
  static get collection() { return this._collection ??= new MutableCollection({name: this.name}); }
  static async fetch(tag) {
    const verified = await this.retrieve({tag, member: null});
    return {tag, /*verified,*/ ...verified.json};
  }
  static persist({tag, verified, ...properties}, options) {
    return this.store(properties, {tag, owner: tag, ...options});
  }
  static assign(properties, data = this.empty) {
    return Object.assign({}, data, properties);
  }
  static retrieve(options) { return this.collection.retrieve(options); }
  static store(data, options) { return this.collection.store(data, options); }
}

export class User extends FairshareModel {
  static empty = {groups: []};
  static async create({prompt, answer, ...properties}) { // Promises tag, not User object
    Credentials.setAnswer(prompt, answer);
    const userTag = await Credentials.createAuthor(prompt);
    const groupTag = Group.communityTag;
    const communityGroup = await Group.fetch(groupTag); // Could have last been written by someone no longer in the group.
    await Group.authorizeUser(groupTag, userTag);
    await User._adoptGroup(userTag, groupTag, this.assign({tag: userTag, ...properties}), communityGroup);
    return userTag;
  }
  static async destroy(userTag) {
    const tag = userTag;
    const groupTag = Group.communityTag;
    await User.abandonGroup(userTag, groupTag);
    await Group.deauthorizeUser(groupTag, userTag);
    await this.collection.remove({tag, owner: userTag, author: userTag});
    await Credentials.destroy(userTag, {resursive: true});
  }
  static async adoptGroup(userTag, groupTag) {
    // Used by a previously authorized user to add themselves to a group,
    // changing both the group data and the user's own list of groups.
    const [user, group] = await Promise.all([User.fetch(userTag), Group.fetch(groupTag)]);
    return await this._adoptGroup(userTag, groupTag, user, group);
  }
  static async _adoptGroup(userTag, groupTag, user, group) {
    user.groups = [...user.groups, groupTag];
    group.users = [...group.users , userTag];
    // No parallel: Do not store user data unless group storage succeeds.
    await Group.persist(group, {author: userTag});
    await User.persist( user,  {author: userTag});
  }
  static async abandonGroup(userTag, groupTag) {
    // Used by user to remove a group from their own user data.
    const user = await User.fetch(userTag);
    user.groups = user.groups.filter(tag => tag !== groupTag);
    return await User.persist(user, {author: userTag});
  }
}

export class Group extends FairshareModel {
  static communityTag = null; // The tag of the Group of which everyone is a member. Must be set by application.
  static empty = {users: []};
  static async create({author:userTag, ...properties}) { // Promises tag, not the group itself.
    // Create group with user as member.
    const groupTag = await Credentials.create(userTag); // userTag is authorized for newly create groupTag.
    const user = await User.fetch(userTag);
    await User._adoptGroup(userTag, groupTag, user, this.assign({tag: groupTag, ...properties}));
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
    const group = await this.fetch(tag);
    group.users = group.users.filter(tag => tag !== userTag);
    await this.persist(group, {author});
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
