import { Credentials, MutableCollection } from '@kilroy-code/flexstore';
import { Rule } from '@kilroy-code/rules';

/*
  This is the glue between our application-specific central model objects,
  Flexstore persistence and synchronization machinery, and
  Rules based UI change-management.
*/

class LiveSet {
  // This could be implemented differently, e.g., as a Proxy. But we don't need to, yet.
  items = {};
  get size() { return 0; }
  forEach(iterator) {
    const {items, size} = this;
    const keys = Object.keys(items);
    for (let index = 0; index < size; index++) iterator(this.get(keys[index]), index, this);
  }
  map(iterator) {
    const {items, size} = this;
    const keys = Object.keys(items);
    const result = Array(size);
    for (let index = 0; index < size; index++) result[index] = iterator(this.get(keys[index]), index, this);
    return result;
  }
  get(tag) {
    return this.items[tag];
  }
  put(tag, item) {
    let {items} = this;
    if (tag in items) items[tag] = item;
    else {
      Rule.attach(items, tag, () => item, {configurable: true}); // deletable
      this.size++;
    }
  }
  delete(tag) {
    let {items} = this;
    items[tag] = null;
    delete items[tag];
    this.size--;
  }
}
Rule.rulify(LiveSet.prototype);

class Persistable { // Can be stored in Flexstore Collection, as a signed JSON bag of enumerated properties.

  static get collection() { // The Flexstore Collection that defines the persistance behavior:
    // sign/verify, encrypt/decrypt, local-first distribution and synchronization, merge semantics, etc.
    // A Collection instance (such as for User or Group) does not contain instance/elements - it just manages
    // their persisted synchronziation through tags.
    return this._collection ??= new MutableCollection({name: this.name});
  }
  static get live() {
    return this._live ??= new LiveSet();
  }
  constructor(properties) { // Works for accessors, rules, or unspecified property names.
    Object.assign(this, properties);
    this.constructor.live.put(properties.tag, this);
  }

  // Ruled properties.
  get tag() { return ''; }
  get title() { return ''; }  

  static async fetch(tag) { // Promise the specified object from the collection.
    // E.g., in a less fancy implementation, this could be fetching the data from a database/server.
    if (!tag) throw new Error("A tag is required.");
    const {live} = this;
    const existing = live.get(tag);
    if (existing) return existing;

    // member:null indicates that we do not verify that the signing author is STILL a member of the owning team at the time of retrieval.
    const verified = await this.retrieve({tag, member: null});
    // Tag isn't directly persisted, but we have it to store in the instance.
    const item = new this({tag, /*verified,*/ ...verified.json});
    return item;
  }
  persist(asUser) { // Promise to save this instance.
    // The list of persistedProperties is defined by subclasses and serves two purposes:
    // 1. Subclasses can define any enumerable and non-enumerable properties, but all-and-only the specificly listed ones are saved.
    // 2. The payload is always in a canonical order (as specified by persistedProperties), so that a hash difference is meaningful.
    const data = {};
    this.constructor.persistedProperties.forEach(name => data[name] = this[name]);
    return this.constructor.persist(data, {author: asUser.tag});
  }
  destroy() {
    this.constructor.live.delete(this.tag);
  }
  static persist({tag, verified, ...properties}, options) { // Pulls out the internal parts to produce the correct signature.
    return this.store(properties, {tag, owner: tag, ...options});
  }

  // Helpers
  static retrieve(options) { return this.collection.retrieve(options); }
  static remove(options) { return this.collection.remove(options); }
  static store(data, options) { return this.collection.store(data, options); }
}

export class User extends Persistable {
  static persistedProperties = ['tag', 'title', 'groups'];
  get groups() { return []; }

  static async create({prompt, answer, ...properties}) { // Promise a provisioned instance, as a member of the community group.
    Credentials.setAnswer(prompt, answer);
    const userTag = await Credentials.createAuthor(prompt);
    const groupTag = Group.communityTag;
    const communityGroup = await Group.fetch(groupTag); // Could have last been written by someone no longer in the group.
    const user = new this({tag: userTag, ...properties}); // adoptGroup will persist it.
    await communityGroup.authorizeUser(user);
    await user.adoptGroup(communityGroup);
    return user;
  }
  async destroy() { // Permanently removes this user from persistence.
    const tag = this.tag;
    const groupTag = Group.communityTag;
    const group = await Group.fetch(groupTag);
    await this.abandonGroup(this);
    await group.deauthorizeUser(this);
    await this.constructor.remove({tag, owner: tag, author: tag});
    await Credentials.destroy(tag, {resursive: true});
    super.destroy();
  }
  createGroup(properties) { // Promise a new group with this user as member
    return Group.create({author: this, ...properties}); // fixme this.tag
  }
  destroyGroup(group) { // Promise to destroy group that we are the last member of
    return group.destroy(this);
  }
  async adoptGroup(group) {
    // Used by a previously authorized user to add themselves to a group,
    // changing both the group data and the user's own list of groups.
    const {tag:userTag} = this,
	  {tag:groupTag} = group;
    this.groups = [...this.groups, groupTag];
    group.users = [...group.users , userTag];
    // Not parallel: Do not store user data unless group storage succeeds.
    await group.persist(this);
    await this.persist(this);
  }
  async abandonGroup(group) {
    // Used by user to remove a group from their own user data.
    const groupTag = group.tag;
    this.groups = this.groups.filter(tag => tag !== groupTag);
    return await this.persist(this);
  }
}

export class Group extends Persistable {
  static communityTag = null; // The tag of the Group of which everyone is a member. Must be set by application.
  static persistedProperties = ['tag', 'title', 'users'];
  get users() { return []; }

  static async create({author:user, ...properties}) { // Promise a new Group with user as member
    const userTag = user.tag;
    const groupTag = await Credentials.create(userTag); // userTag is authorized for newly create groupTag.
    const group = new this({tag: groupTag, ...properties}); // adoptGroup will persist it.
    await user.adoptGroup(group);
    return group;
  }
  async destroy(asUser) {
    // Used by last group member to destroy a group.
    // TODO? Check that we are last?
    const {tag} = this;
    await this.constructor.remove({tag, owner: tag, author: asUser.tag});
    await asUser.abandonGroup(this);
    await Credentials.destroy(tag);
    super.destroy();
  }
  authorizeUser(candidate) {
    // Used by any team member to add the user to the group's key set.
    // Note that it does not add the user to the Group data, as the user does that when they adoptGroup.
    // This is different than deauthorizeUser
    return Credentials.changeMembership({tag: this.tag, add: [candidate.tag]});
  }
  async deauthorizeUser(user, author = user) {
     // Used by any team member (including the user) to remove user from the key set AND the group.
     // Does NOT change the user's data.
    this.users = this.users.filter(tag => tag !== user.tag);
    this.persist(author);
    await Credentials.changeMembership({tag: this.tag, remove: [user.tag]});
  }
}

// The default properties to be rullified are "any an all getters, if any, otherwise <something-ugly>".
// As it happens, each of these three defines at least one getter.
[Persistable, User, Group].forEach(kind => Rule.rulify(kind.prototype));

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
