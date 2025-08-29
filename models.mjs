import { Credentials, MutableCollection, VersionedCollection } from '@kilroy-code/flexstore';
import { Rule } from '@kilroy-code/rules';
/*
  All this is the glue between our application-specific central model objects,
  Flexstore persistence and synchronization machinery, and
  Rules based UI change-management.
*/

export { Rule };
export class LiveSet { // A Rules-based cross between a Map and an Array. It is used to represent a
  // a dynamic set of values, each identified by a key string, such as tags by which a collection of datum
  // are persisted. Rules can reference the values by key, or as a group by map/forEach.
  //
  // A LiveSet can be mutated by changing the value at a keys through the Map-like set/delete operations.
  // The value can themselves be Rulified objcts, or any other value EXCEPT undefined or null.
  // Other Rules can reference these values though Map-like get/has, or through Array-like map/forEach,
  // and those rules will track the changes.
  //
  // This could be implemented differently, e.g., as a Proxy. But we don't need to, yet.
  items = {};
  get size() { // Tracked rule that lazilly caches on demand after one or more set/delete.
    return Object.keys(this.items).length;
  }
  // We do not currently support length/at(), as these would need to managed deleted items.
  forEach(iterator) {
    const {items, size} = this;
    const length = size;
    const keys = Object.keys(items);
    for (let index = 0; index < length; index++) {
      const value = items[keys[index]];
      if (value === null) continue;
      iterator(value, index, this);
    }
  }
  map(iterator) {
    const {items, size} = this;
    const length = size;
    const keys = Object.keys(items);
    const result = Array(length);
    let skipped = 0;
    for (let index = 0; index < length; index++) {
      const value = items[keys[index]];
      if (value === null) { skipped++; continue; }
      result[index - skipped] = iterator(value, index, this);
    }
    result.length -= skipped;
    return result;
  }
  has(key) {
    const {items, size} = this;
    return size && (key in items) && items[key] !== null;
  }
  get(key) {
    const {items, size} = this;
    return size && items[key];
  }
  set(key, item) {
    let {items} = this;
    this.size = undefined;
    if (key in items) {
      items[key] = item;
    } else {
      Rule.attach(items, key, item); // If we deleted (see comment below), we would need to additionally pass {configurable: true})
    }
  }
  delete(key) { // has/get/at will answer as falsy, and existing references will be reset.
    // Note however, that it does not actually remove key, but sets its value to null. (See next comment.)
    let {items} = this;
    this.size = undefined;
    if (!(key in items)) return;
    items[key] = null; // Any references to items[key] will see that this was reset.
    // We COULD do the following, and remove the key until such time that something later sets it.
    // HOWEVER, any rules that referenced the key would be stuck knowing only that their referencee
    // was set to null (above). It wouldn't know about any NEW rule created later at that key.
    // So... we have to leave the rule intact.
    //delete items[key];
  }
}
Rule.rulify(LiveSet.prototype);

////////////////////////////////
/// Base persistence classes
////////////////////////////////

// In general:
//
// - fetch(tag) promises the object denoted by tag, idempotently using the directory LiveSet.
// - update(tag, verifiedData) from update events causes the in-memory object to be updated and any dependent rules to be recursively reset.
// - adoptByTag/abandonByTag keeps track of whether this device has owner key access to which PublicPrivate instances, adding or clearing any private data.
// - Reaching in to to assign new property values will recursively reset dependent rules, but not persist the object.
// - edit(changedProperties) promises to update and persist.
//
// - Do not mix public and private data. Use two collections if needed, with the private collection members encrypted.
// - VersionedCollections are the only ones that can be written by other than the owner. (Because their merging can reconstruct through bogus writes.)
// - Data that corresponds 1:1 with an owner but with different privacy, versioning, etc. - e.g., Group and it's Messages - can be put it in another collection with the same tag.
// - Data that needs to be 2-keyed - e.g., user balances in a group - the consituent keys can be concatenated, xor-ed, or mapped to a GUID.
// - Some data can be reproduced and should probably not be stored unless needed for, e.g, exposure. E.g., Group member id can be produced from the keyset recipients,
//   and current tax/stipend can be reproduced from voting. However, the historic values of the latter are (currently) available as a public history (for investors).


// Defines persist/edit/destroy instance methods that manage the object's persistence, which retain the tag through which it is persisted.
// Defines fetch/update class methods that operate on tags, creating the instance.
// Data is persisted as a canonicalized JSON, including title, which is a reference-tracking (Rule) property.
class Persistable { // Can be stored in Flexstore Collection, as a signed JSON bag of enumerated properties.

  static get collection() { // The Flexstore Collection that defines the persistance behavior:
    // sign/verify, encrypt/decrypt, local-first distribution and synchronization, merge semantics, etc.
    //
    // A Collection instance (such as for User or Group) does not contain instance/elements - it just manages
    // their persisted synchronziation through tags. Compare uses of LiveSet, below.
    return this._collection ??= new this.collectionType({name: this.prefix + this.name});
  }
  static prefix = 'social.fairshare.';
  static collectionType = MutableCollection;

  constructor({verified = null, ...properties}) { // Works for accessors, rules, or unspecified property names.
    // Verified is null for constructed stuff, and non-null if successfully fetched.
    // But see PublicPrivate persist().
    Object.assign(this, {verified, ...properties});
  }
  static async fetch(tag) { // Promise the specified object from the collection.
    // E.g., in a less fancy implementation, this could be fetching the data from a database/server.
    if (!tag) throw new Error("No tag was specified for fetch.");
    // member:null indicates that we do not verify that the signing author is STILL a member of the owning team at the time of retrieval.
    const verified = await this.collection.retrieve({tag, member: null});
    // Tag isn't directly persisted, but we have it to store in the instance.
    // Note that if verified comes back with an empty string, this produces an empty object with tag and verified.
    return new this({tag, verified, ...verified.json});
  }
  persistOptions({author = this.author, owner = this, tag = this.tag, ...rest}) {
    return {tag, ...rest, owner: owner?.tag || tag, author: author?.tag || tag};
  }
  persistProperty(data, name, value) { // Adds value to data POJO IFF it should be stored.
    // We generally don't want to explicitly store things that can be computed by rules, for canonicalization purposes (and size).
    // Lots of ways this could be done. This simple version just omits falsy and empty array.
    if (Array.isArray(value) && !value.length) return;
    // Note that if a value was meaningfully different as 0, '', false, [], this would fail to preserve that.
    if (!value) return;
    data[name] = value;
  }
  async captureProperties(propertyNames)  {
    // The list of persistedProperties is defined by subclasses and serves two purposes:
    // 1. Subclasses can define any enumerable and non-enumerable properties, but all-and-only the specificly listed ones are saved.
    // 2. The payload is always in a canonical order (as specified by persistedProperties), so that a hash difference is meaningful.
    if (!propertyNames.length) return null; // Useful in debugging, but otherwise can be removed.
    const data = {};
    for (const name of propertyNames) {
      const value = await this[name]; // May be a rule that has not yet be resolved.
      this.persistProperty(data, name, value);
    }
    return data;
  }
  async persistProperties(propertyNames, collection, options)  {
    const data = await this.captureProperties(propertyNames);
    if (!data) return data;
    const persistOptions = this.persistOptions(options);
    return await collection.store(data, persistOptions);
  }
  persist(author) { // Promise to save this instance.
    const {persistedProperties, collection} = this.constructor;
    return this.persistProperties(persistedProperties, collection, {author});
  }
  destroy(options) { // Remove item from collection, as the specified author.
    // FIXME: shouldn't this be leaving a tombstone??
    return this.constructor.collection.remove(this.persistOptions(options));
  }
  edit(changedProperties, asUser = this) { // Asign the data and persist for everyone.
    Object.assign(this, changedProperties);
    return this.persist(asUser);
  }
  static async update(tag, verified) { // Suitable for use in a Collection update event handler.
    // No need to edit(), as by definition the new data has already been persisted.
    Object.assign(await this.fetch(tag), {verified, ...verified.json});
  }
  assert(boolean, label, ...labelArgs) {
    if (!boolean) throw new Error(label, ...labelArgs);
  }

  static persistedProperties = ['title'];
  // Ruled properties.
  get tag() { return ''; }   // A string that identifies the item, as used by fetch, e.g. Typically base64url.
  get title() { return ''; } // A string that is enough for a human to say, roughly, "that one".
}

// Additionally keeps track of the instances that have been fetched, so that fetch can return previously generated instances.
// The directory is a LiveSet that tracks (by tag) all the instances that have been fetched so far.
export class Enumerated extends Persistable {
  // In contrast with the collection property (which does not hold any instances), there are some type-specific
  //  enumerations of instances. Each is implemented as a LiveSet, so that:
  // 1. constructor/fetch/destroy can keep track of them, returning the same instance in each call.
  // 2. Changes to their membership cause references to the enumeration to update.
  // One such enumeration, common to both User and Group, is directory.
  // Other examples are in the respective subclasses.
  
  // This is lazy getter rather than a simple static property so that subclasses have their own LiveSet.
  // E.g., User and Group can each use the same same tags to denote different objects.
  static get directory() { return this._directory ??= new LiveSet(); }

  constructor(properties) { // Save it in the directory for use by fetch.
    super(properties);
    this.constructor.directory.set(properties.tag, this); // Here rather than fetch, so as to include newly created stuff.
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

// Splits the persisted data into public/unencrypted and private/encrypted parts, persisted in separate collections with the same tag.
export class PublicPrivate extends Enumerated {
  // Automatically splits and combines from a second collection that is encrypted.
  static get privateCollection() {
    return this._privateCollection ??= new this.privateCollectionType({name: this.prefix + this.name + 'Private'});
  }
  static privateCollectionType = MutableCollection;

  // Keep track of which objects are "ours", so that:
  // 1. They can be displayed differently.
  // 2. When we get updates, we know whether to attept to decrypt and update private data, and to act on it (e.g. notifications).
  // In both cases the app may need to distinguish between whether they are accessible to the current (app-specific) user,
  // or to any of the device's authorized users. this.myOwners.has(key) and !this.myOwners.size are both reset on adoptByTag/abandonByTag.
  myOwners = new LiveSet();
  async adoptByTag(tag) { // The instance is one that we own. Add private data. (Security is enforced by cryptography, not by this.)
    const {myOwners} = this;
    if (myOwners.has(tag)) return this;
    const populated = myOwners.size;
    myOwners.set(tag, tag); // Pun: value is also tag, so that myOwners.forEach/.map provides a way to iterate over owners.
    if (populated) return this;
    const verifiedPrivate = await this.constructor.privateCollection.retrieve(this.tag); // Might be '' right now.
    const assignment = {verifiedPrivate, ...(verifiedPrivate?.json || {})};
    Object.assign(this, assignment);
    return this;
  }
  abandonByTag(tag) { // This is no longer one that we own. Clear private data.
    const {myOwners} = this;
    if (!myOwners.has(tag)) return this;
    myOwners.delete(tag);
    if (myOwners.size) return this;
    this.constructor.privateProperties.forEach(property => { // We were the last: reset private properties.
      this[property] = undefined;
    });
    return this;
  }
  async refetch(re_adopt = true) { // Rebuild from persistence, adopting again if it was and is requested now.
    // Used for testing.
    const {myOwners} = this;
    const isMine = myOwners.size;
    const pastOwners = [];
    await Promise.all(myOwners.map(tag => {
      pastOwners.push(tag);
      return this.abandonByTag(tag);
    }));
    this.constructor.directory.delete(this.tag);
    const item = await this.constructor.fetch(this.tag);
    if (isMine && re_adopt) {
      await Promise.all(pastOwners.map(tag => item.adoptByTag(tag)));
    }
    return item;
  }
  async persist(author) { // Promise to save this instance.
    const {privateProperties, privateCollection} = this.constructor;
    const data = await this.captureProperties(privateProperties);
    const pprivate = await this.persistProperties(privateProperties, privateCollection, {author, encryption: this.tag}, data);
    // A private object has no public data. A fetch will produce empty string in the 'verified' property.
    // We explicitly set that on creation, too.
    // Either way, we don't persist an empty string in the public colleciton.
    const ppublic = this.verified !== '' ? await super.persist(author) : pprivate;
    if (pprivate !== ppublic) throw new Error(`Unexpected producted different tags ${pprivate} and ${ppublic} for ${this.title}.`);
    return pprivate;
  }
  async destroy(options) { // Remove from private, too.
    const {tag} = this;
    await super.destroy(options);
    await this.constructor.privateCollection.remove(this.persistOptions(options));
  }
  static async updatePrivate(tag, verifiedPrivate) { // Used for update event on this.privateCollection.
    // There is an update handler on this.collection (using this.update), and one this.privateCollection using this method here.
    // The 'update' event machinery cannot decrypt payloads for us, because the data might not be ours.
    // But if it is one of ours, then surely we can decrypt it, which we need to do so that the properties can be updated.
    const fetched = await this.fetch(tag);
    if (!fetched.myOwners.size) return;
    verifiedPrivate = await MutableCollection.ensureDecrypted(verifiedPrivate);
    Object.assign(fetched, {verifiedPrivate, ...(verifiedPrivate?.json || {})});
  }
}

export class History extends Enumerated {
  // Persists as a history (often under the same tag as a related application object such as a Group).
  static collectionType = VersionedCollection;
  async persistToSet(liveSet, host) {
    const tag = await this.persist();
    this.assert(tag === host.tag, "Mismatched message collection tag", tag, host.tag);
    const collection = this.constructor.collection;
    const hash = this.tag = await collection.getRoot(host.tag);
    liveSet.set(hash, this);
    return this;
  }
}

////////////////////////////////
/// Application Classes
////////////////////////////////

// Your own personas have non-empty devices on which it is authorized and groups to which it belongs.
// All users have title, picture, and interestingly, a map of secret prompt => hash of answer, so that you can authorize additional personas on the current device.
// There are instance methods to create/destroy and authorize/deauthorize,
// and create/destroyGroup and adopt/abandonGroup.
export class User extends PublicPrivate {
  // properties are listed alphabetically, in case we ever allow properties to be automatically determined while retaining a canonical order.
  static persistedProperties = ['picture', 'secrets'].concat(PublicPrivate.persistedProperties);
  static privateProperties = ['devices', 'groups', 'bankTag'];
  get picture() { return ''; } // A media tag, or empty to use identicon.
  get devices() { return {}; } // Map of deviceName => userDeviceTag so that user can remotely deauthorize.
  get groups() { return []; }  // Tags of the groups this user has joined.
  get bankTag() { return ''; } // Tag of the group that is used to access the reserve currency. (An element of groups.)
  get secrets() { return {}; }  // So that we know what to prompt when authorizing, and can preConfirmOwnership.
  get shortName() { return this.title.split(/\s/).map(word => word[0].toUpperCase()).join('.') + '.'; }

  static async create({secrets, deviceName, bankTag, ...properties}) { // Promise a provisioned instance.
    // PERSISTS Credentials, then Groups, then User

    // Create credential.
    const hashes = await this.setUpSecretsForClaiming(secrets);
    const userTag = await Credentials.createAuthor(secrets[0][0]); // TODO: make createAuthor create multiple KeyRecovery members.
    const deviceTag = await this.clearSecretsAndGetDevice(userTag, secrets);
    const devices = {[deviceName]: deviceTag};

    const user = new this({tag: userTag, devices, secrets:hashes, ...properties}); // will be persisted by adoptGroup, below.
    await user.initialize(bankTag);
    return user;
  }
  static async claim({secrets, deviceName, invitation, ...properties}) {
    const hashes = await this.setUpSecretsForClaiming(secrets);
    const userTag = await Credentials.claimInvitation(invitation, secrets[0][0]);
    const deviceTag = await this.clearSecretsAndGetDevice(userTag, secrets);
    const devices = {[deviceName]: deviceTag};

    const user = await User.fetch(userTag);
    await user.edit({devices: {[deviceName]: deviceTag}, secrets: hashes, ...properties, verified: null});
    return user;
  }
  static async setUpSecretsForClaiming(secrets) { // Given [...[prompt, answer]], setAnswer for all, and promise a dictionary of prompt=>hash suitable for user.secrets
    const hashes = {};
    await Promise.all(secrets.map(async ([prompt, answer]) => {
      Credentials.setAnswer(prompt, answer);
      hashes[prompt] = Credentials.encodeBase64url(await Credentials.hashText(answer));
    }));
    return hashes;
  }
  static async clearSecretsAndGetDevice(userTag, secrets) {
    // For use immediately after createAuthor or claimInvitation with userTag. Clears answers set tby setUpSecretsForClaiming, and promises the deviceTag
    secrets.forEach(([prompt]) => Credentials.setAnswer(prompt, null));
    // Since we just created it ourselves, we know that userTag has only one Device tag member, and the rest are KeyRecovery tags.
    // But there's no DIRECT way to tell if a tag is a device tag.
    const members = await Credentials.teamMembers(userTag);
    return await Promise.any(members.map(async tag => (!await Credentials.collections.KeyRecovery.get(tag)) && tag));
  }
  async initialize(bankTag) { // Set up initial private data for this user. Execution requires the bank members key set.
    await this.adoptByTag(this.tag); // Personal group and bank are private User data.
    // Add personal group-of-one (for notes, and for receiving /welcome messages.
    await this.createGroup({tag: this.tag, verified: ''}); // Empty verified keeps us from publishing the group to public directory.
    // Now add the specified bank.
    Object.assign(this, {bankTag});
    const bank = await FairShareGroup.fetch(bankTag);
    await bank.authorizeUser(this); // Requires that this be executed by someone already in that group!
    await this.adoptGroup(bank);
  }
  async createInvitation({bankTag = this.bankTag} = {}) { // As a user, create an invitation tag for another human to use to create an account.
    const chat = await this.createGroup({verified: ''}); // Private group-of-2 for this sponsoring user and the new invitee.
    // The (private) user will exist and already be a member of its personal group, the specified bank, and a new pairwise chat group with the inviting user.
    // When the invitation is claimed, the claiming human will fill in the device/secrets and title.
    const userTag = await Credentials.createAuthor('-');
    const user = new this.constructor({tag: userTag, verified: ''});
    await user.initialize(bankTag);
    chat.authorizeUser(user);
    user.adoptGroup(chat);
    user.abandonByTag(user.tag); // To be adopted by the claimant.
    return userTag;
  }
  async destroy({prompt, answer}) { // Permanently removes this user from persistence.
    // PERSISTS Personal Group, then User and Credentials interleaved.
    // Requires prompt/answer because this is such a permanent user action.
    const {tag} = this;
    await this.preConfirmOwnership({prompt, answer});

    // Leave every group that we are a member of.
    await Promise.all(this.groups.map(async groupTag => {
      const group = await FairShareGroup.fetch(groupTag);
      if ((group.users.length === 1) && (group.users[0] === this.tag)) { // last memember of group
	await this.destroyGroup(group);
      } else {
	await this.abandonGroup(group);
	await group.deauthorizeUser(this);
      }
    }));

    // Get rid of User data from collections and LiveSets.
    await super.destroy({});

    // Get rid of credential.
    Credentials.setAnswer(prompt, answer); // Allow recovery key to be destroyed, too.
    await Credentials.destroy({tag, recursiveMembers: true});
    Credentials.setAnswer(prompt, null);
  }
  async adoptByTag(tag) {
    await super.adoptByTag(tag);
    // Now that we have user's groups...
    await Promise.all(this.groups.map(groupTag => FairShareGroup.fetch(groupTag).then(group => group.adoptByTag(tag))));
    return this;
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
    await this.adoptByTag(tag); // Updates this with private data, adding devices entry.
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
    await this.abandonByTag(tag);
    return deviceTag; // Facilitates testing.
  }
  createGroup(properties) { // Promise a new group with this user as member
    return FairShareGroup.create({author: this, ...properties});
  }
  destroyGroup(group) { // Promise to destroy group that we are the last member of
    return group.destroy(this);
  }
  async adoptGroup(group) {
    // Used by a previously authorized user to add themselves to a group,
    // changing both the group data and the user's own list of groups.
    // PERSISTS Group, then User
    const {tag:userTag} = this;
    const {tag:groupTag} = group;
    await group.adoptByTag(userTag);
    const users = group.users;
    this.groups = [...this.groups, groupTag];
    // TODO: users should come from teamMembers. No reason for additional property. That MIGHT result in no privatGroup data at all.
    group.users = [...users , userTag];
    // Not parallel: Do not store user data unless group storage succeeds.
    await group.persist(this);
    await this.persist(this);
  }
  async abandonGroup(group) {
    // Used by user to remove a group from their own user data.
    // PERSISTS User
    await group.abandonByTag(this.tag);
    const groupTag = group.tag;
    this.groups = this.groups.filter(tag => tag !== groupTag);
    return await this.persist(this);
  }
}

export class Message extends History {
  // Has additional properties author, timestamp, and type, which are currently unencrypted in the header. (We may encrypt author tag.)
  // A lightweight immutable object, belonging to a group.
  // Type, timestamp, and author are in the protectedHeader via persistOptions.
  get author() { return null; }
  get owner() { return this.author; }
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
  persistOptions({author = this.author, owner = this.owner, ...options}) {
    const ownershipType = owner.users.includes(author.tag) ? 'owner' :
	  ((owner instanceof User) ? 'individual' : 'group');
    const authorTag = author.tag;
    const ownerTag = owner.tag;
    const signing = {
      ...options, 
      time: this.timestamp.getTime(),
      tag: this.owner.tag, // Messages are accumulated in same id as owner
      author: authorTag,
      [ownershipType]: ownerTag,
      encryption: ownerTag,
      mt: this.type === 'text' ? undefined : this.type
    };
    return signing;
  }
}

export class Group extends PublicPrivate {
  // Persistables, either public or private:
  static collectionType = VersionedCollection;
  static privateCollectionType = VersionedCollection;
  static persistedProperties = ['picture'].concat(PublicPrivate.persistedProperties);
  static privateProperties = ['users'];
  get title() { // A string by which the group is known.
    if (this.users.length === 1) return "Yourself";
    return Promise.all(this.users.map(tag => User.fetch(tag).then(user => user.shortName)))
      .then(shorts => shorts.join(', '));
  }
  get users() { // A list of tags.
    return [];
  }

  static async create({author:user, tag = Credentials.create(user.tag), ...properties}) { // Promise a new Group with user as member
    // PERSISTS Credential (unless provided), then Group, then User
    // userTag is authorized for newly create groupTag.
    tag = await tag;
    const group = new this({tag, ...properties}); // adoptGroup will persist it.
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
}

// We don't actually instantiate different subclasses of Group. This break out is just for maintenance.
class MessageGroup extends Group { // Supports a history of messages.
  // Messages are persisted through a VersionedCollection with the same tag as us.
  // As they become known (sent by our user or from a connection), the are added here.
  messages = new LiveSet();
  async send(properties, author) { // Sends Messages as author.
    // PERSISTS Message, and sets its tag to the StatCollection hash/tag.
    return await new Message({...properties, author, owner: this}).persistToSet(this.messages, this);
  }
  // todo: update messages with new entries. test.
}

export class Member extends History {
  static DIVISIONS = 100; // for now
  static MILLISECONDS_PER_DAY = 1e3 * 60 * 60 * 24;
  get balance() { return 0; }
  get lastUpdate() { return Date.now(); }
  updateBalance(stipend, increment = 0) {
    const now = Date.now();
    let {balance, lastStipend = now} = this;
    const daysSince = Math.floor((now - lastStipend) / this.constructor.MILLISECONDS_PER_DAY);
    lastStipend = now;
    return this.balance = this.roundDownToNearest(balance + (stipend * daysSince) + increment);
  }
  roundUpToNearest(number, unit = this.constructor.DIVISIONS) { // Rounds up to nearest whole value of unit.
    return Math.ceil(number * unit) / unit;
  }
  roundDownToNearest(number, unit = this.constructor.DIVISIONS) { // Rounds up to nearest whole value of unit.
    return Math.floor(number * unit) / unit;
  }
}

class TokenGroup extends MessageGroup { // Supports a balance for each member.
  static persistedProperties = ['rate', 'stipend'].concat(MessageGroup.persistedProperties);
  get rate() {
    return 0;
  }
  get stipend() {
    return 0;
  }
  get tagBytes() {
    const size = 32;
    let uint8 = Credentials.decodeBase64url(this.tag);
    if (uint8.length === size)  return uint8;
    const larger = new Uint8Array(size);
    larger.set(uint8);
    return larger;
  }
  getMemberTag(userTag) { // Return the persistence tag for user within this group.
    // user.tag XOR group.tag
    const nBytes = 32;
    const userBytes = Credentials.decodeBase64url(userTag);
    const groupBytes = this.tagBytes;
    const result = new Uint8Array(nBytes);
    for (let i = 0; i < nBytes; i++) {
      result[i] = (userBytes.length <= i ? 0 : userBytes[i]) ^ groupBytes[i];
    }
    return Credentials.encodeBase64url(result);
  }
  members = new LiveSet();
  // We update members on adopt/abandonGroup, and fetch/update of known privateGroup.
  ensureMember(userTag) {
    const member = Member.fetch(this.getmemberTag(userTag));
    this.members.set(userTag, member);
    return member;
  }
}

class VotingGroup extends TokenGroup { // Supports voting for members and monetary policy.
}

export class FairShareGroup extends VotingGroup { // Application-level group with combined behavior.
}

// The default properties to be rullified are "any an all getters, if any, otherwise <something-ugly>".
// As it happens, each of these three defines at least one getter.
[Persistable, User, Message, Group, TokenGroup].forEach(kind => Rule.rulify(kind.prototype));
