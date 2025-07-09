import { Credentials, MutableCollection } from '@kilroy-code/flexstore';

/*
  This is the glue between our application-specific central model objects,
  Flexstore persistence and synchronization machinery, and
  Rules based UI change-management.
*/

class Persistable { // Can be stored in Flexstore Collection, as a signed JSON bag of enumerated properties.

  static get collection() { // The Flexstore Collection that defines the persistance behavior:
    // sign/verify, encrypt/decrypt, local-first distribution and synchronization, merge semantics, etc.
    // A Collection instance (such as for User or Group) does not contain instance/elements - it just manages
    // their persisted synchronziation through tags.
    return this._collection ??= new MutableCollection({name: this.name});
  }
  static async fetch(tag) { // Promise the specified object from the collection.
    // E.g., in a less fancy implementation, this could be fetching the data from a database/server.
    const verified = await this.retrieve({tag, member: null}); // null indicates that we do not
    // verify that the signing author is STILL a member of the owning team at the time of retrieval.
    return new this({tag, /*verified,*/ ...verified.json});
  }
  constructor(properties) { // Works for accessors, rules, or unspecified property names.
    Object.assign(this, properties);
  }
  persist(options) { // Promise to save this instance.
    // The list of persistedProperties is defined by subclasses and serves two purposes:
    // 1. Subclasses can define any enumerable and non-enumerable properties, but all-and-only the specificly listed ones are saved.
    // 2. The payload is always in a canonical order (as specified by persistedProperties), so that a hash difference is meaningful.
    const data = {};
    this.constructor.persistedProperties.forEach(name => data[name] = this[name]);
    return this.constructor.persist(data, options);
  }
  static persist({tag, verified, ...properties}, options) { // Pulls out the internal parts to produce the correct signature.
    return this.store(properties, {tag, owner: tag, ...options});
  }
  // Helpers
  static retrieve(options) { return this.collection.retrieve(options); }
  static store(data, options) { return this.collection.store(data, options); }
}

export class User extends Persistable {
  constructor(properties) { // Ensures a list of groups that to which this user belongs.
    super({groups: [], ...properties});
  }
  static persistedProperties = ['tag', 'title', 'groups'];

  static async create({prompt, answer, ...properties}) { // Promises tag, not User object
    Credentials.setAnswer(prompt, answer);
    const userTag = await Credentials.createAuthor(prompt);
    const groupTag = Group.communityTag;
    const communityGroup = await Group.fetch(groupTag); // Could have last been written by someone no longer in the group.
    const user = new this({tag: userTag, ...properties});
    await Group.authorizeUser(groupTag, userTag);
    await user.adoptGroup(communityGroup);
    return userTag;
  }
  destroy() { // Permanently removes this user from persistence.
    return this.constructor(this.tag);
  }
  static async destroy(userTag) { // Permanently removes the specified user from persistence.
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
    return await user.adoptGroup(group);
  }
  async adoptGroup(group) {
    // Used by a previously authorized user to add themselves to a group,
    // changing both the group data and the user's own list of groups.
    const {tag:userTag} = this,
	  {tag:groupTag} = group;
    this.groups = [...this.groups, groupTag];
    group.users = [...group.users , userTag];
    // Not parallel: Do not store user data unless group storage succeeds.
    await group.persist({author: userTag});
    await this.persist({author: userTag});
  }
  static abandonGroup(userTag, groupTag) { // Remove group from the specified user's groups.
    return User.fetch(userTag).then(user => user.abandonGroup(groupTag));
  }
  async abandonGroup(groupTag) {
    // Used by user to remove a group from their own user data.
    this.groups = this.groups.filter(tag => tag !== groupTag);
    return await this.persist({author: this.tag});
  }
}

export class Group extends Persistable {
  static communityTag = null; // The tag of the Group of which everyone is a member. Must be set by application.
  constructor(properties) {
    super({users: [], ...properties});
  }
  static persistedProperties = ['tag', 'title', 'users'];

  static async create({author:userTag, ...properties}) { // Promises tag, not the group itself.
    // Create group with user as member.
    const groupTag = await Credentials.create(userTag); // userTag is authorized for newly create groupTag.
    const user = await User.fetch(userTag);
    await user.adoptGroup(new this({tag: groupTag, ...properties}));
    return groupTag;
  }
  destroy(userTag) {
    return this.constructor.destroy(this.tag, userTag);
  }
  static async destroy(groupTag, userTag) {
    // Used by last group member to destroy a group.
    // TODO? Check that we are last?
    const tag = groupTag;
    await this.collection.remove({tag, owner: tag, author: userTag});
    await User.abandonGroup(userTag, groupTag);
    await Credentials.destroy(groupTag);
  }
  authorizeUser(candidateTag) {
    return this.constructor.authorizeUser(this.tag, candidateTag);
  }
  static authorizeUser(groupTag, candidateTag) {
    // Used by an existing member to add someone to the group's key
    // so that the candidate can then adoptGroup.
    const tag = groupTag;
    return Credentials.changeMembership({tag, add: [candidateTag]});
  }
  static deauthorizeUser(groupTag, userTag, author = userTag) {
    return this.fetch(groupTag).then(group => group.deauthorizeUser(userTag, author));
  }
  async deauthorizeUser(userTag, author = userTag) {
     // Used by any team member (including the user) to remove user from the group and its key.
     // Does NOT change the user's data.
    this.users = this.users.filter(tag => tag !== userTag);
    this.persist({author});
    await Credentials.changeMembership({tag: this.tag, remove: [userTag]});
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
