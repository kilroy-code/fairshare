import { Credentials, MutableCollection, VersionedCollection } from '@kilroy-code/flexstore';
import { Rule } from '@kilroy-code/rules';

/*
  This is the glue between our application-specific central model objects,
  Flexstore persistence and synchronization machinery, and
  Rules based UI change-management.

  TODO: The lower level VersionedCollection is currently defined independently of messages, and I now
        think that is wrong. To merge forked states, we need to be able to replay messages against
        a common earlier state. Fixing that will interact with the code here.
  TODO: I'm not sure that we need a community group. Get rid of it?
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
  has(tag) {
    return tag in this.items;
  }
  get(tag) {
    return this.items[tag];
  }
  at(index) {
    const {items} = this;
    const keys = Object.keys(items);
    return items[keys[index]];
  }
  put(tag, item) {
    let {items} = this;
    if (this.has(tag)) items[tag] = item;
    else {
      Rule.attach(items, tag, () => item, {configurable: true}); // deletable
      this.size++;
    }
  }
  delete(tag) {
    let {items} = this;
    if (!this.has(tag)) return;
    items[tag] = null; // Any references to items[tag] will see that this was reset.
    delete items[tag];
    this.size--;
  }
}
Rule.rulify(LiveSet.prototype);

class Persistable { // Can be stored in Flexstore Collection, as a signed JSON bag of enumerated properties.

  static get collection() { // The Flexstore Collection that defines the persistance behavior:
    // sign/verify, encrypt/decrypt, local-first distribution and synchronization, merge semantics, etc.
    //
    // A Collection instance (such as for User or Group) does not contain instance/elements - it just manages
    // their persisted synchronziation through tags. Compare uses of LiveSet, below.
    return this._collection ??= new this.collectionType({name: this.prefix + this.name});
  }
  static prefix = 'social.fairshare.';
  static collectionType = MutableCollection

  constructor(properties) { // Works for accessors, rules, or unspecified property names.
    Object.assign(this, properties);
  }
  static async fetch(tag) { // Promise the specified object from the collection.
    // E.g., in a less fancy implementation, this could be fetching the data from a database/server.
    if (!tag) throw new Error("A tag is required.");
    // member:null indicates that we do not verify that the signing author is STILL a member of the owning team at the time of retrieval.
    const verified = await this.collection.retrieve({tag, member: null});
    // Tag isn't directly persisted, but we have it to store in the instance.
    return new this({tag, verified, ...verified.json});
  }
  persistOptions({author = this.author, owner = this, tag = this.tag, ...rest}) {
    return {tag, ...rest, owner: owner?.tag || tag, author: author?.tag || tag};
  }
  persistProperties(propertyNames, collection, options)  {
    // The list of persistedProperties is defined by subclasses and serves two purposes:
    // 1. Subclasses can define any enumerable and non-enumerable properties, but all-and-only the specificly listed ones are saved.
    // 2. The payload is always in a canonical order (as specified by persistedProperties), so that a hash difference is meaningful.
    if (!propertyNames.length) return null; // Useful in debugging, but otherwise can be removed.
    const data = {};
    const persistOptions = this.persistOptions(options);
    propertyNames.forEach(name => {
      const value = this[name];
      if (value) data[name] = value;
    });
    return collection.store(data, persistOptions);
  }
  persist(author) { // Promise to save this instance.
    const {persistedProperties, collection} = this.constructor;
    return this.persistProperties(persistedProperties, collection, {author});
  }
  destroy(options) { // Remove item from collection, as the specified author.
    // FIXME: shouldn't this be leaving a tombstone??
    return this.constructor.collection.remove(this.persistOptions(options));
  }
  edit(changedProperties, asUser = this) {
    Object.assign(this, changedProperties);
    return this.persist(asUser);
  }

  // Ruled properties.
  get tag() { return ''; }   // A string that identifies the item, as used by fetch, e.g. Typically base64url.
  get title() { return ''; } // A string that is enough for a human to say, roughly, "that one".
}

export class Enumerated extends Persistable {
  // In contrast with the collection property (which does not hold any instances), there are some type-specific
  //  enumerations of instances. Each is implemented as a LiveSet, so that:
  // 1. constructor/fetch/destroy can keep track of them, returning the same instance in each call.
  // 2. Changes to their membership cause references to the enumeration to update.
  // One such enumeration, common to both User and Group, is directory.
  // Other examples are in the respective subclasses.
  static get directory() {
    return this._directory ??= new LiveSet();
  }
  constructor(properties) { // Save it in the directory for use by fetch.
    super(properties);
    this.constructor.directory.put(properties.tag, this); // Here rather than fetch, so as to include newly created stuff.
  }
  static fetch(tag) { // Gets from directory cache if present. Still a promise.
    const cached = this.directory.get(tag);
    if (cached) return Promise.resolve(cached);
    return super.fetch(tag);
  }
  async destroy(options) { // Remove from directory.
    await super.destroy(options);
    this.constructor.directory.delete(this.tag);
  }
}

export class PublicPrivate extends Enumerated {
  // In addition to the directory, provides a second LiveSet that are the SUBSET that are mine.
  // Automatically splits and combines from a second privateCollection that are encrypted.
  static get privateCollection() {
    return this._privateCollection ??= new this.privateCollectionType({name: this.prefix + this.name + 'Private'});
  }
  static privateCollectionType = MutableCollection;
  static get privateDirectory() {
    return this._privateDirectory ?? new LiveSet();
  }
  static async fetchPrivate(tag) { // Fetch public and additional private data, merging the decrypted private data into the object.
    const {privateDirectory} = this;
    if (privateDirectory.has(tag)) return this.privateDirectory.get(tag);
    const [instance, privateData] = await Promise.all([this.fetch(tag), this.privateCollection.retrieve(tag)]);
    Object.assign(instance, privateData.json); // Merge the private data.
    privateDirectory.put(tag, instance);
    return instance;
  }
  async persist(author) { // Promise to save this instance.
    const {privateProperties, privateCollection} = this.constructor;
    const pprivate = await this.persistProperties(privateProperties, privateCollection, {author, encryption: this.tag});
    const ppublic = await super.persist(author);
    if (pprivate !== ppublic) throw new Error(`Unexpected producted different tags ${pprivate} and ${ppublic} for ${this.title}.`);
    return pprivate;
  }
  async destroy(options) { // Remove from private, too.
    const {tag} = this;
    await super.destroy(options);
    await this.constructor.privateDirectory.delete(this.tag);
    await this.constructor.privateCollection.remove(this.persistOptions(options));
  }
}

////////////////////////////////

export class User extends PublicPrivate {
  // properties are listed alphabetically, in case we ever allow properties to be automatically determined while retaining a canonical order.
  static persistedProperties = ['picture', 'secrets', 'title'];
  static privateProperties = ['devices', 'groups'];
  get picture() { return ''; } // A media tag, or empty to use identicon.
  get devices() { return {}; } // Map of deviceName => userDeviceTag so that user can remotely deauthorize.
  get groups() { return []; }  // Tags of the groups this user has joined.
  get secrets() { return {}; }  // So that we know what to prompt when authorizing, and can preConfirmOwnership.
  get shortName() { return this.title.split(/\s/).map(word => word[0].toUpperCase()).join('.') + '.'; }

  static async create({secrets, deviceName, ...properties}) { // Promise a provisioned instance, as a member of the community group.
    // PERSISTS Credentials, then Groups, then User

    // Create credential.
    const hashes = {};
    await Promise.all(secrets.map(async ([prompt, answer]) => {
      Credentials.setAnswer(prompt, answer);
      hashes[prompt] = Credentials.encodeBase64url(await Credentials.hashText(answer));
    }));
    const userTag = await Credentials.createAuthor(secrets[0][0]); // TODO: make createAuthor create multiple KeyRecovery members.
    secrets.forEach(([prompt]) => Credentials.setAnswer(prompt, null));

    // Since we just created it ourselves, we know that userTag has only one Device tag member, and the rest are KeyRecovery tags.
    // But there's no DIRECT way to tell if a tag is a device tag.
    const members = await this.getMemberTags(userTag);
    const deviceTag = await Promise.any(members.map(async tag => (!await Credentials.collections.KeyRecovery.get(tag)) && tag));
    const devices = {[deviceName]: deviceTag};

    const user = new this({tag: userTag, devices, secrets:hashes, ...properties}); // adoptGroup will persist it.

    // Add personal group-of-one (for notes, and for receiving /welcome messages.
    await user.createGroup({tag: userTag});

    // Now add the community group.
    const groupTag = Group.communityTag;
    const communityGroup = await Group.fetch(groupTag); // Could have last been written by someone no longer in the group.
    await communityGroup.authorizeUser(user); // Requires that this be executed by someone already in that group!
    await user.adoptGroup(communityGroup);
    return user;
  }
  async destroy({prompt, answer}) { // Permanently removes this user from persistence.
    // PERSISTS Personal Group, then User and Credentials interleaved.
    // Requires prompt/answer because this is such a permanent user action.
    await this.preConfirmOwnership({prompt, answer});
    const {tag} = this;

    await this.destroyGroup(await Group.fetch(tag)); // Destroy personal group while we're still a member.
    
    // Leave every group that are a member of.
    await Promise.all(this.groups.map(async groupTag => {
      const group = await Group.fetch(groupTag);
      await this.abandonGroup(group);
      await group.deauthorizeUser(this);
    }));

    // Get rid of User data from collections and LiveSets.
    await super.destroy({});

    // Get rid of credential.
    Credentials.setAnswer(prompt, answer); // Allow recovery key to be destroyed, too.
    await Credentials.destroy({tag, recursiveMembers: true});
    Credentials.setAnswer(prompt, null);
  }
  async preConfirmOwnership({prompt, answer}) { // Reject if prompt/answer are valid for this user.
    // Can be used up front, rather than waiting and getting errors.
    // Note that one could get a false positive by trying to, e.g., sign something, because the device might be present.
    // (And creating the secret key from answer can be a bit slow.)
    // Instead, we store the HASH of the answer in the user's public data, and compare.
    // Note that prompt is actually a concatenation of multiple prompt tags,
    // and answer is a canonicalized concatenation of the respective answers.
    const hash = Credentials.encodeBase64url(await Credentials.hashText(answer));
    return this.secrets[prompt] === hash;
  }
  async authorize({prompt, answer, deviceName}) { // Add this user to the set that I have private access to on this device (not remote).
    // PERSISTS Credential
    // Requires prompt/answer because that's what we use to gain access to the user's key set.
    await this.preConfirmOwnership({prompt, answer});
    const {tag} = this;

    // Creat a local device key set, and add to user team.
    const deviceTag = await Credentials.create();  // This is why it cannot be remote. We cannot put a device keyset on another device.
    Credentials.setAnswer(prompt, answer);
    await Credentials.changeMembership({tag, add: [deviceTag]});  // Must be before fetch.
    Credentials.setAnswer(prompt, null);
    await User.fetchPrivate(tag); // Updates this with private data, adding devices entry.
    const {devices} = this;
    devices[deviceName] = deviceTag; // TODO?: Do we want to canonicalize deviceName order?
    await this.edit({devices});
  }
  async deauthorize({prompt, answer, deviceName}) { // Remove this user from the set that I have private access to on the specified device.
    // PERSISTS Credential.
    // Requires prompt/answer so that we are sure that the user will still be able to recover access somewhere.
    await this.preConfirmOwnership({prompt, answer});
    const {tag, devices} = this;
    const deviceTag = devices[deviceName];  // Remove device key tag from user private data.
    delete devices[deviceName];
    await this.edit({devices});

    await Credentials.changeMembership({tag, remove: [deviceTag]}); // Remove device key tag from user team.
    await Credentials.destroy(deviceTag)  // Might be remote: try to destroy device key, and swallow error.
      .catch(() => console.warn(`${this.title} device key set ${deviceTag} on ${deviceName} is not available from here.`));

    return deviceTag; // Facilitates testing.
  }
  createGroup(properties) { // Promise a new group with this user as member
    return Group.create({author: this, ...properties});
  }
  destroyGroup(group) { // Promise to destroy group that we are the last member of
    return group.destroy(this);
  }
  async adoptGroup(group) {
    // Used by a previously authorized user to add themselves to a group,
    // changing both the group data and the user's own list of groups.
    // PERSISTS Group, then User
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
    // PERSISTS User
    const groupTag = group.tag;
    this.groups = this.groups.filter(tag => tag !== groupTag);
    this.constructor.privateDirectory.delete(groupTag);  // Does not remove data from directory.
    return await this.persist(this);
  }
  // Internal
  static async getMemberTags(tag) { // List the member tags of this user: devices, recovery, and co-signers.
    const team = await Credentials.collections.Team.retrieve({tag, member: null});
    return team.json.recipients.map(m => m.header.kid); // IWBNI flexstore provides this.
  }
}

export class Message extends Persistable {
  // A lightweight immutable object, belonging to a group.
  static collectionType = VersionedCollection;
  static persistedProperties = ['title']; // Type, timestamp, and author are in the protectedHeader vis persistOptions.
  get author() { return null; }
  get timestamp() { return new Date(); }
  get type() { return 'text'; }
  constructor(properties) {
    super(properties);
    if (this.verified) { // Fetched.
      const {iat, act, iss, mt} = this.verified.protectedHeader;
      this.timestamp = new Date(iat);
      this.author = User.fetch(act);
      this.owner = User.fetch(iss);
      if (mt) this.type = mt;
    } // Else properties should include author and owner objects.
  }
  persistOptions({author = this.author, ...options}) {
    return {time: this.timestamp.getTime(), tag: this.owner.tag,
	    owner: author.tag, author: author.tag,
	    encryption: this.owner.tag,
	    mt: this.type === 'text' ? undefined : this.type,
	    ...options};
  }
}

export class Group extends PublicPrivate {
  static communityTag = null; // The tag of the Group of which everyone is a member. Must be set by application.
  static privateCollectionType = VersionedCollection;
  static persistedProperties = ['picture', 'title'];
  static privateProperties = ['users'];
  get users() { return []; }
  get title() {
    if (this.users.length === 1) return "Yourself";
    return Promise.all(this.users.map(tag => User.fetch(tag).then(user => user.shortName)))
      .then(shorts => shorts.join(', '));
  }
  messages = new LiveSet();

  static async create({author:user, tag = Credentials.create(user.tag), ...properties}) { // Promise a new Group with user as member
    // PERSISTS Credential (unless provided), then Group, then User
    // userTag is authorized for newly create groupTag.
    const group = new this({tag: await tag, ...properties}); // adoptGroup will persist it.
    await user.adoptGroup(group);
    return group;
  }
  async destroy(author) {
    // Used by last group member to destroy a group.
    // PERSISTS Messages, then User, then Group, then Credential
    // TODO? Check that we are last?
    const {tag} = this;
    await Message.collection.remove({tag, owner: tag, author: author.tag});
    await author.abandonGroup(this);
    await super.destroy({author});
    if (tag === author.tag) return; // If a personal group that shares credentials with author, we're done.
    await Credentials.destroy(tag);
  }
  authorizeUser(candidate) {
    // Used by any team member to add the user to the group's key set.
    // PERSISTS Credential
    // Note that it does not add the user to the Group data, as the user does that when they adoptGroup.
    // This is different than deauthorizeUser.
    return Credentials.changeMembership({tag: this.tag, add: [candidate.tag]});
  }
  async deauthorizeUser(user, author = user) {
    // Used by any team member (including the user) to remove user from the key set AND the group.
    // PERSISTS Group then Credential
    // Does NOT change the user's data.
    this.users = this.users.filter(tag => tag !== user.tag);
    await this.persist(author);
    await Credentials.changeMembership({tag: this.tag, remove: [user.tag]});
  }
  async send(properties, author) { // Sends Messages as author.
    // PERSISTS Message
    const message = new Message({...properties, author, owner: this});
    await message.persist();
    const collection = message.constructor.collection; // It's a shame we have reconstruct the following.
    const versions = await collection.getVersions(this.tag);
    const hash = message.tag = versions[versions.latest];
    this.messages.put(hash, message);
  }
}

// The default properties to be rullified are "any an all getters, if any, otherwise <something-ugly>".
// As it happens, each of these three defines at least one getter.
[Persistable, User, Message, Group].forEach(kind => Rule.rulify(kind.prototype));

// TODO
// message
// pay user
// is voting an edit group operation? a message operation?
// request join
// invite non-member
