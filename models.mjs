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
    let count = 0;
    for (const value of Object.values(this.items)) value && count++; // Thar be nulls.
    return count;
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
// Speculative: not implemented or tested yet.
// When data has been persisted, verified (and/or verifiedProtected) will be a string. The empty string indicates that the persisted data is not verifiable.
// A value of null indicates that the public or private data (respectively) is not to be persisted.
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
export class Persistable { // Can be stored in Flexstore Collection, as a signed JSON bag of enumerated properties.

  static get collection() { // The Flexstore Collection that defines the persistance behavior:
    // sign/verify, encrypt/decrypt, local-first distribution and synchronization, merge semantics, etc.
    //
    // A Collection instance (such as for User or Group) does not contain instance/elements - it just manages
    // their persisted synchronziation through tags. Compare uses of LiveSet, below.
    return this._collection ??= new this.collectionType({name: this.prefix + this.name});
  }
  static prefix = 'social.fairshare.';
  static collectionType = MutableCollection;
  static persistedProperties = ['title'];
  get tag() { return this._tag; } // A string that identifies the item, as used by fetch. Not a tracked rule, so verified and other dependencies will NOT recompute when assigned.
  set tag(string) {
    if (!string) return;
    if (this._tag) throw new Error(`Cannot re-assign tag (from ${this._tag} to ${string}).`);
    this._tag = string;
  }
  // Ruled properties.
  get author() { return this; } // Should be assigned to whichever user should be recorded as author when persisted. Value must have a tag property.
  get owner() { return this.author; } // Should be assigned to whichever user should be recorded as owner when persisted. Value must have a tag property.
  get title() { return ''; } // A string that is enough for a human to say, roughly, "that one".
  get persistOptions() {
    return {author: this.author?.tag, owner: this.owner?.tag};
  }
  get verified() {
    return this.verifiedPublic;
  }
  get verifiedPublic() { // Persists on demand, and resets if the public data changes.  Can be assigned null to keep the public data from being persisted.
    return this.getVerifiedPersistence();
  }
  
  constructor(properties = {}) { // Works for accessors, rules, or unspecified property names.
    Object.assign(this, properties);
  }
  async captureProperty(data, name) { // Adds value to data POJO IFF it should be stored.
    const value = await this[name]; // May be a rule that has not yet be resolved.
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
    const data = {};
    for (const name of propertyNames) {      
      await this.captureProperty(data, name);
    }
    return data;
  }
  async persistProperties(propertyNames = this.constructor.persistedProperties, collection = this.constructor.collection, persistOptions = this.persistOptions)  {
    // Saves the specified data, and side-effects tag IFF it wasn't already known.
    if (!propertyNames.length) return null;
    const data = await this.captureProperties(propertyNames); // Might be empty if all are default, in which case go ahead and store empty.
    let options = await persistOptions;
    let tag = this.tag;
    if (tag) options = {tag, ...options};
    const persisted = await collection.store(data, options);
    if (!tag) tag = this.tag = persisted;
    return tag;
  }
  async getVerifiedPersistence(propertyNames, collection = this.constructor.collection, persistOptions) {
    const tag = await this.persistProperties(propertyNames, collection, persistOptions);
    // TODO: Modify Flexstore to allow the client to capture this, rather than having to regenerate it.
    return await collection.retrieve(tag);
  }
  maybeUpdateAuthor(asUser = null) { // Update author if specified, and answer this.
    if (asUser) this.author = asUser;
    return this;
  }
  static create(properties) { // Create an instance with the specified properties.
    return new this(properties);
  }
  static fetchData(tag) { // Get all the necessary peristed data, in verified format.
    return this.collection.retrieve({tag, member: null});
  }
  static async fetch(tag, asUser = null) { // Promise the specified object from the collection.
    // E.g., in a less fancy implementation, this could be fetching the data from a database/server.
    // member:null indicates that we do not verify that the signing author is STILL a member of the owning team at the time of retrieval.
    const verified = await this.fetchData(tag);
    // Tag isn't directly persisted, but we have it to store in the instance.
    // Note that if verified comes back with an empty string, this produces an empty object with tag and verified.
    return this.create({tag, verified, ...verified.json}).maybeUpdateAuthor(asUser);
  }
  static update(tag, verified) { // Suitable for use in a Collection update event handler.
    // Admittedly, this doesn't have a lot of use in this class, except as the super for subclasses.
    //
    // It seems weird to create() for an update, but if a subclass like Enumerated is going to be caching,
    // it will do so in create().

    // No need to persist as by definition the new data has already been persisted.
    // And indeed we couldn't persist anyway because we don't know what user and owner to do so as, and might not have that user's key set.
    // - verified.json might still be encrypted.
    // - The directory property is synchronously assigned if necessary.
    return this.create({tag, verified, ...verified.json}); // Returned value isn't often used, but it makes testing more convenient.
  }
  edit(changedProperties, asUser = null) { // Asign the data and persist for everyone.
    Object.assign(this, changedProperties);
    return this.maybeUpdateAuthor(asUser).verified;
  }
  async destroy({author, owner} = {}) { // Remove item from collection, with the specified credentials if specified (else from properties).
    // TODO?: shouldn't this be leaving a tombstone??
    const options = {...await this.persistOptions, tag: this.tag};
    if (author) options.author = author.tag;
    if (owner) options.owner = owner.tag;
    await this.constructor.collection.remove(options);
    return options;
  }
  assert(boolean, label, ...labelArgs) {
    if (!boolean) throw new Error(label, ...labelArgs);
  }
}

// Additionally keeps track of the instances that have been created, fetched, or updated, so that fetch can return previously generated instances.
// The directory is a LiveSet that tracks (by tag) all the instances that have are known so far.
// (Compare with Flexstore Collections, which persists data but does not hold any instances.)
export class Enumerated extends Persistable {
  static directory = new LiveSet(); // Subclasses should redefine, so that multiple subclasses can use the same keys for different instances.
  initializationPromise = null; // Can be set by constructor to a promise that resolves when all initialized.
  updateDirectory(tag = this.tag) { // Cache this through tag.
    if (!tag) {
      const verified = this.verifiedPublic || this.verifiedPrivate; // If verfiedPublic has been assigned '' to have no public presence, use private.
      if (verified.then) return this.initializingPromise = verified.then(verified => this.maybeSetCachedInstance(verified.tag));
      tag = verified.tag;
    }
    return this.maybeSetCachedInstance(tag);
  }
  maybeSetCachedInstance(tag) { // Assign this to directory at tag if appropriate. May be overwritten.
    // The tag is always known if we got here through fetch, update, or new with an explicit tag.
    // In all such cases, we synchronously cache this in directory.
    //
    // However, there is at least one important case where use new without a tag: instantiating an immutable.
    // In that case, we must asynchronously compute the verified POJO (persisting the instance as a side effect).
    // During that time, we may yet get an update() for the same tag, which by definition will have the same
    // data for everything but the protected headers. In that case, we do not overwrite the intervening instance.
    const { directory } = this.constructor;
    if (!directory.has(tag)) directory.set(tag, this);
    return this;
  }
  static create({tag, ...properties} = {}) { // Create an instance with the specified properties.
    const cached = tag && this.directory.get(tag);
    if (cached) {
      // Constructing something twice with the same tag may be of questionable value.
      // However, we have to updateDirectory for new instances so that updates that come in from others will work, even if we do not fetch.
      // Given that, we might as well check here that there is an existing instance.
      Object.assign(cached, properties); // without re-assigning tag
      return cached;
    }
    const instance = super.create({tag, ...properties});
    return instance.updateDirectory(tag);
  }
  async destroy(options) { // Remove from directory.
    options = await super.destroy(options);
    this.constructor.directory.delete(this.tag);
    return options;
  }
  // We do not redefine fetch here, e.g., to avoid retrieving the persisted data if the instance is cached.
  // An app would normally know whether a local, live, un-saved instance is newer than what is saved, and not fetch again.
  // However, if an app has an un-owned PublicPrivate instance (such that it only has public properties filled in), and then
  // takes ownership of the instance and fetches again, we DO want refetched data (particularly the private data) to be assigned.
  // That's what super.fetch() does, so no need to change anything.
}

// Splits the persisted data into public/unencrypted and private/encrypted parts, persisted in separate collections with the same tag.
export class PublicPrivate extends Enumerated {
  // Automatically splits and combines from a second collection that is encrypted.
  static directory = new LiveSet();
  static get privateCollection() {
    return this._privateCollection ??= new this.privateCollectionType({name: this.prefix + this.name + 'Private'});
  }
  static privateCollectionType = MutableCollection;
  get verifiedPrivate() { // Same as verified, but for private data persistence, which is encrypted.
    return this.getVerifiedPersistence(this.constructor.privateProperties,
				       this.constructor.privateCollection,
				       {...this.persistOptions, encryption: this.owner.tag});
  }
  get verified() { // Both sequentially, in we're computing tag for the first time.
    return this.constructor.combinePublicPrivateData(this.verifiedPublic, this.verifiedPrivate);
  }
  static async update(tag, verified) {
    const owned = this.directory.get(tag)?.owner?.tag === this.privateCollection.getOwner(verified.protectedHeader);
    if (owned) verified = await this.privateCollection.ensureDecrypted(verified);
    // SUBTLE: If not owned, there's no decryption, but:
    // - verified PUBLIC data will still have a cleartext json to update with.
    // - verified PRIVATE data will not have a json at all. An update will ensure a cached object, but will not initialize any private properties.
    return await super.update(tag, verified);
  }
  async destroy(options) { // Additionally remove from privateCollection;
    options = await super.destroy(options);
    await this.constructor.privateCollection.remove(options);
    return options;
  }

  static async fetchData(tag) {
    const [verifiedPublic, verifiedPrivate] = await Promise.all([
      this.collection.retrieve({tag, member: null}),
      this.privateCollection.retrieve({tag, member: null})
    ]);
    return this.combinePublicPrivateData(verifiedPublic, verifiedPrivate);
  }
  static combinePublicPrivateData(verifiedPublic, verifiedPrivate) {
    const vpublic = verifiedPublic || {};
    const vprivate = verifiedPrivate || {};
    return {...vpublic, vprivate, json: {...(vpublic.json || {}), ...(vprivate.json || {})}};
  }
}

// For VersionedCollections: 
// - create/fetch/update has the same semantics as for any Enumerated collection:
//      They cache an instance that reflects the current data for tag, and the directory maps top-level tags to cached instances.
//      This top-level instance and tag are sometimes called the subject instance or tag.
//      This subject instance can be edited and persisted to generate newer versions.
//      An additional hash property identifies the hash of this dynamic current version.
// - In addition, each top-level tag instance has a versions property with a LiveSet:
//    - The tags of the versions correspond to StateCollection hashes, and they map to instances corresponding to a specific historical version.
//    - Each has a lazy antecedent property, which when demanded, ensures that the versions LiveSet includes the specified hash.
//    - The individual state instances, identified by hash, do not appear in the top level directory, but rather within the versions LiveSet
//      of a dynamic toplevel tag instance.
export class History extends Enumerated {
  static directory = new LiveSet();
  versions = new LiveSet();
  static async update(tag, verified) { // Suitable for update handler of History.collection.itemEmitter (for which 'tag' is a the version hash).
    // Update the subject instance, which will reset any modified properties.
    // Ensure the version instance exists.
    return super.update(tag, verified);
  }
  get antecedent() {
    // Ensure that the version instance exists.
    const verified = this.verified;
    const {ant} = verified.protectedHeader;
    const instance = this.versions.get(ant);
    if (instance) return instance;
    instance = new this.constructor({verified, ...verified.json});
    this.versions.set(ant, instance);
    return instance;
  }
  get verified() {
    // IF this is a subject instance, ensure that the version instance exists.
    return super.__verified();
  }
}

[Persistable, PublicPrivate, History].forEach(kind => Rule.rulify(kind.prototype));


////////////////////////////////
/// Application Classes
////////////////////////////////

export class Entity extends PublicPrivate { // A top level User or Group in FairShare
  static persistedProperties = ['picture'].concat(PublicPrivate.persistedProperties);
  get picture() { return ''; } // A media tag, or empty to use identicon.
  get tagBytes() { // The group tag as Uint8Array(32). Used with xor to compute memberTag.
    const size = 32;
    let uint8 = Credentials.decodeBase64url(this.tag);
    if (uint8.length === size)  return uint8;
    const larger = new Uint8Array(size);
    larger.set(uint8);
    return larger;
  }
}

// Your own personas have non-empty devices on which it is authorized and groups to which it belongs.
// All users have title, picture, and interestingly, a map of secret prompt => hash of answer, so that you can authorize additional personas on the current device.
// There are instance methods to create/destroy and authorize/deauthorize,
// and create/destroyGroup and adopt/abandonGroup.
export class User extends Entity {
  // properties are listed alphabetically, in case we ever allow properties to be automatically determined while retaining a canonical order.
  static persistedProperties = ['secrets'].concat(Entity.persistedProperties);
  static privateProperties = ['devices', 'groups', 'bankTag'];
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

export class Group extends Entity {
  // Persistables, either public or private:
  static collectionType = VersionedCollection;
  static privateCollectionType = VersionedCollection;
  static privateProperties = ['users'];
  get title() { // A string by which the group is known.
    if (this.users.length === 1) return "Yourself";
    return Promise.all(this.users.map(tag => User.fetch(tag).then(user => user.shortName)))
      .then(shorts => shorts.join(', '));
  }
  get users() { // A list of tags. TODO: compute from keyset recipients and don't persist? 
    return [];
  }

  static async create({author:user, tag = Credentials.create(user.tag), ...properties}) { // Promise a new Group with user as member
    // PERSISTS Credential (unless provided), then Group, then User
    // userTag is authorized for newly create groupTag.
    tag = await tag;
    const group = new this({tag, author:user, ...properties}); // adoptGroup will persist it.
    await user.adoptGroup(group);
    return group;
  }
  async destroy(author) {
    // Used by last group member to destroy a group.
    // PERSISTS User, then Group, then Credential
    // TODO? Check that we are last?
    const {tag} = this;
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

export class Message extends History {
  // Has additional properties author, timestamp, and type, which are currently unencrypted in the header. (We may encrypt author tag.)
  // A lightweight immutable object, belonging to a group.
  // Type, timestamp, and author are in the protectedHeader via persistOptions.
  //get author() { return null; }
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
  xxpersistOptions({author = this.author, owner = this.owner, ...options}) {
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
    console.log('persistOptions', {author, owner, options, ownershipType, authorTag, ownerTag, signing});
    return signing;
  }
}

// We don't actually instantiate different subclasses of Group. This break out is just for maintenance.
class MessageGroup extends Group { // Supports a history of messages.
  async send(properties, author) { // Sends Messages as author.
    // PERSISTS Message, and sets its tag to the StateCollection hash/tag.
    const {tag} = this;
    console.log('send', {properties, tag, author, owner: this});
    return await new Message({...properties, tag, author, owner: this}).persist(author); //fixme remove .persistToSet(this.messages, this);
  }
  // todo: update messages with new entries. test.
  async destroy(author) {
    // PERSISTS Messages, then User, then Group, then Credential
    const {tag} = this;
    await Message.collection.remove({tag, owner: tag, author: author.tag});
    await super.destroy(author);
  }
}

export class Member extends History {
  get balance() { return 0; }
  get lastUpdate() { return Date.now(); }
}

class TokenGroup extends MessageGroup { // Supports a balance for each member.
  static persistedProperties = ['rate', 'stipend'].concat(MessageGroup.persistedProperties);
  get rate() { // The tax rate charged by this Group. Tax is burned.
    return 0;
  }
  get stipend() { // The universal supplemental income minted each day for each member.
    return 0;
  }
  getMemberTag(user) { // Return the persistence tag for user within this group.
    // user.tag XOR group.tag
    const nBytes = 32;
    const userBytes = user.tagBytes;
    const groupBytes = this.tagBytes;
    const result = new Uint8Array(nBytes);
    for (let i = 0; i < nBytes; i++) {
      result[i] = userBytes[i] ^ groupBytes[i];
    }
    return Credentials.encodeBase64url(result);
  }
  members = new LiveSet();
  // We update members on adopt/abandonGroup, and fetch/update of known privateGroup.
  async ensureMember(user, asMember) {
    const {members} = this;
    const member = members.get(user.tag);
    if (member) return member;
    member = await Member.fetch(this.getmemberTag(user));
    await member.adoptByTag(asMember.tag); // We don't have owner permission for the User, but we do for the Member.
    members.set(user.tag, member);
    return member;
  }

  // These are tracked rules so that the results of a proposed transfer can be shown to user before committing.
  get sender() { // What Member is paying for the transaction. Assigned by UI
    return null;
  }
  get receiver() { // What Memmber is receiving the transaction. Assigned by UI.
    return null;
  }
  get amount() { // The amount to be added to receiver, after fees. Assigned by UI.
    return 0;
  }
  get fee() { // How much extra is charged by the group.
    return -this.amount * this.rate;  // Updates as amount or rate changes.
  }
  get cost() { // How much will the proposed transfer actually cost sender.
    return -this.amount + this.fee; // Updates as amount or fee changes.
  }
  get tick() { // At what timestamp does the transaction take place?
    return Date.now();
  }
  get senderBalance() { // What will be the sender's balance, updated with changes to the above.
    if (!this.sender) return 0; // Minted.
    return this.computeUpdatedBalance(this.sender, this.cost);
  }
  get receiverBalance() { // Same for receiver.
    if (!this.receiver) return 0; // Burned.
    return this.computeUpdatedBalance(this.receiver, this.amount);
  }
  get divisions() { // How many divisions of a unit are to be preserved. I.e., how much is a "penny"?
    return 100;
  }
  static MILLISECONDS_PER_DAY = 1e3 * 60 * 60 * 24;
  computeUpdatedBalance(member, increment) { // Compute what the balance would be, updating from stipend at tick.
    let now = this.tick;
    let {balance = 0, lastStipend = now} = member;
    const daysSince = Math.floor((now - lastStipend) / this.constructor.MILLISECONDS_PER_DAY);
    return this.roundDownToNearest(balance + (this.stipend * daysSince) + increment);
  }
  roundUpToNearest(number, unit = this.constructor.DIVISIONS) { // Rounds up to nearest whole value of unit.
    return Math.ceil(number * unit) / unit;
  }
  roundDownToNearest(number, unit = this.constructor.DIVISIONS) { // Rounds up to nearest whole value of unit.
    return Math.floor(number * unit) / unit;
  }
  async commitTransfer(author) { // Persist sender, receiver, for current values of amount, tick, etc.
    // Note that tick is not updated, and so sender/receiver balances will be as displayed.
    // If the UI wants to, it can reset tick before calling this.
    const {tick, senderBalance, receiverBalance, sender, receiver} = this;
    console.log({tick, senderBalance, receiverBalance, sender, receiver});
    const promises = [];
    if (sender) {
      sender.balance = senderBalance;
      sender.lastUpdate = tick;
      promises.push(sender.persist(author));
    }
    if (receiver) {
      receiver.balance = receiverBalance;
      receiver.lastUpdate = tick;
      promises.push(receiver.persist(author));
    }
    await Promise.all(promises);
  }
}

class VotingGroup extends TokenGroup { // Supports voting for members and monetary policy.
}

export class FairShareGroup extends VotingGroup { // Application-level group with combined behavior.
}

// The default properties to be rullified are "any an all getters, if any, otherwise <something-ugly>".
// As it happens, each of these three defines at least one getter.
[Entity, User, Message, Group, Member, TokenGroup].forEach(kind => Rule.rulify(kind.prototype));
