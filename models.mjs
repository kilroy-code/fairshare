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

  constructor(properties) {
    const {items} = this;
    for (const key in properties) items[key] = properties[key];
  }
  items = {};
  get size() { // Tracked rule that lazilly caches on demand after one or more set/delete.
    let count = 0;
    for (const value of Object.values(this.items)) value && count++; // Thar be nulls.
    return count;
  }
  // We do not currently support length/at(), as these would need to managed deleted items.
  forEach(iterator) { // Applies iterator(value, key, this) for each item that has been set but not deleted, and creates dependency on each item and set/delete.
    const {items, size} = this;
    const keys = Object.keys(items);
    const length = size && keys.length; // depends on size for reset
    for (let index = 0; index < length; index++) {
      const key = keys[index];
      const value = items[key];
      if (value === null) continue;
      iterator(value, key, this);
    }
  }
  map(iterator) { // As for forEach, but collecting results returned by iterator.
    const {items, size} = this;
    const keys = Object.keys(items);
    const length = size && keys.length; // depends on size for reset
    const result = Array(length);
    let skipped = 0;
    for (let index = 0; index < length; index++) {
      const key = keys[index];
      const value = items[key];
      if (value === null) { skipped++; continue; }
      result[index - skipped] = iterator(value, key, this);
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
// - Reaching in to to assign new property values will recursively reset dependent rules, but not persist the object.
// - edit(changedProperties) promises to update and persist.
//
// - VersionedCollections are the only ones that can be written by other than the owner. (Because their merging can reconstruct through bogus writes.)
// - Data that corresponds 1:1 with an owner but with different privacy, versioning, etc. - e.g., Group and it's Messages - can be put in another collection with the same tag.
// - Data that needs to be 2-keyed - e.g., user balances in a group - the consituent keys can be concatenated, xor-ed, or mapped to a GUID.
// - Some data can be reproduced and should probably not be stored unless needed for, e.g, exposure. E.g., Group member ids can be produced from the keyset recipients,
//   and current tax/stipend can be reproduced from voting. However, the historic values of the latter are (currently) available as a public history (for investors).


// Defines persist/edit/destroy instance methods that manage the object's persistence.
// Defines fetch/update class methods that operate on tags, creating the instance.
// Data is persisted as a canonicalized JSON, including title, which is a reference-tracking (Rule) property.
// author/owner appear in the signature of the persisted data, not the JSON itself.
export class Persistable {
  constructor({verified, ...properties} = {}) { // Clients should generally use ensure() instead.
    this.constructor.assign(this, {...(verified?.json || {}), verified, ...properties});
  }
  static ensure(properties) { // Make sure there is an instance with the specified properties. Subclasses extend.
    // Not named create() as that is usually app-specific.
    return new this(properties);
  }
  static async fetch(tag, asUser = null) { // Promise the specified object from the collection.
    // E.g., in a less fancy implementation, this could be fetching the data from a database/server.
    // member:null indicates that we do not verify that the signing author is STILL a member of the owning team at the time of retrieval.
    const verified = await this.fetchData(tag, asUser);
    // Tag isn't directly persisted, but we have it to store in the instance.
    // Note that if verified comes back with an empty string, this produces an empty object with tag and verified.
    const instance = await this.ensure({tag, verified});
    return instance.maybeUpdateAuthor(asUser);
  }
  static async update(tag, verified) { // Suitable for use in a Collection update event handler.
    // Admittedly, this doesn't have a lot of use in this class, except as the super for subclasses.
    //
    // No need to persist as by definition the new data has already been persisted.
    // And indeed we couldn't persist anyway because we don't know what user and owner to do so as, and might not have that user's key set.
    // - verified.json might still be encrypted.
    // - The directory property is synchronously assigned if necessary.

    // If a local author (e.g., someone on this device has adopted for writing), then decrypt.
    if (this.directory.get(tag)?.author) verified = await this.collection.ensureDecrypted(verified);
    
    return await this.ensure({tag, verified}); // Returned value isn't often used, but it makes testing more convenient.
  }
  async edit(changedProperties, asUser = null) { // Asign the data and persist for everyone.
    // Always returns a promise (even if everything can be done synchronously) so that callers may rely on it being thenable.
    this.constructor.assign(this, changedProperties);
    return await this.persist(asUser);
  }
  async destroy({author, owner} = {}) { // Remove item from collection, with the specified credentials if specified (else from properties).
    // TODO: use same positional arguments as maybeUpdateAuthor().
    // TODO?: shouldn't this be leaving a tombstone??
    const options = {...await this.persistOptions, tag: this.tag};
    if (author) options.author = author.tag;
    if (owner) options.owner = owner.tag;
    const {collection, listingCollection} = this.constructor;
    await collection.remove(options);
    await listingCollection.remove?.(options);
    return options;
  }

  // Conveniences
  async persist(author = null, owner = null) { // Use specified author/owner to produce verified persistence.
    // FIXME? Make these named arguments to match destroy()?
    this.maybeUpdateAuthor(author, owner);
    // If we were fetched or updated, these were assigned, and will not recompute, so reset them.
    // But: preserve any explicit no-op setting.
    this.verifiedMain = this.verified = undefined;
    if (this._verifiedListing?.cached !== '') this.verifiedListing = undefined; // UGH!!!
    await this.verifiedMain;
    await this.verifiedListing;
    return this.verified;
  }
  maybeUpdateAuthor(asUser = null, asOwner = null) { // Update author if specified, and answer this.
    if (asUser?.tag) this.author = asUser;   // asUser might be specified in callers as 'true', e.g., to indicate that fetched data should be decoded.
    if (asOwner?.tag) this.owner = asOwner;
    return this;
  }
  assert(boolean, label, ...labelArgs) {
    if (!boolean) throw new Error(label, ...labelArgs);
  }

  // Properties and rules.
  get tag() { // A string that identifies the item, as used by fetch.
    return this._tag;   // Not a tracked rule, so verified and other dependencies will NOT recompute when assigned.
  } 
  set tag(string) { // Can only be assigned once, at construction or automatically by persistence.
    if (!string) return;
    if (this._tag) throw new Error(`Cannot re-assign tag (from ${this._tag} to ${string}).`);
    this._tag = string;
  }

  // Ruled properties.
  get author() { // Assign with user that should be recorded as author when persisted. Value must have a tag property.
    return ''; // A truthy value indicates that this instance has been owned by a current user.
  } 
  get owner() {  // Assign with user that should be recorded as owner when persisted. Value must have a tag property.
    return this.author;
  }
  get title() { // A string that is enough for a human to say, roughly, "that one".
    return '';
  }
  get persistOptions() { // Answers the Flexstore store() options.
    const options = {author: this.author?.tag, owner: this.owner?.tag};
    const encryption = this.constructor.encrypt && this.owner?.tag;
    return encryption ? {encryption, ...options} : options;
  }
  get verifiedMain() { // Persists on demand, and resets if the public data changes.  Can be assigned null to keep the public data from being persisted.
    return this.getVerifiedPersistence();
  }
  // This is somewhat specific to FairShare. Should probably pull this out into a mixin.
  get verifiedListing() {
    const {listingProperties, listingCollection} = this.constructor;
    if (!listingProperties.length) return '';
    const options = {...this.persistOptions};
    delete options.encryption;
    return this.getVerifiedPersistence(listingProperties, listingCollection, options);
  }
  get verified() { // Both verifiedMain and verifiedListing.
    return this.constructor.combinePublicPrivateData(this.verifiedMain, this.verifiedListing);
  }

  // Implementation

  // The Flexstore Collection that defines the persistance behavior:
  // sign/verify, encrypt/decrypt, local-first distribution and synchronization, merge semantics, etc.
  //
  // A Collection instance (such as for User or Group) does not contain instance/elements - it just manages
  // their persisted synchronziation through tags. Compare uses of LiveSet, below.
  static makeCollection(kind = this.collectionType, suffix = '') {
    return new kind({name: this.prefix + this.name + suffix});
  }
  static prefix = '';
  static collectionType = MutableCollection;
  static listingCollectionType = MutableCollection;
  // Each subclass gets their own collection instance. Note: a Flexstore Collection instance represents the interface
  // through which the application instances are stored. It does not maintain a set of collection elements in memory.
  static get collection() { // main collection
    // Written this way (as a getter with hasOwn) so that each subclass of Persistable maintains its own named Collection.
    if (Object.hasOwn(this, '_collection')) return this._collection;
    return this._collection = this.makeCollection();
  }
  static get listingCollection() { // Optional separate collection for public listing of some instances, with
    // unencrypted data (e.g., title). Only truthy if this.listingProperties is not empty.
    if (Object.hasOwn(this, '_listingCollection')) return this._listingCollection;
    return this._listingCollection = this.listingProperties.length && this.makeCollection(this.listingCollectionType, 'Listing');
  }
  static persistedProperties = ['title'];
  static listingProperties = [];
  static encrypt = false; // Whether the main persistedProperties should be encrypted.
  static combinePublicPrivateData(verified, verifiedListing) { // Adds the verifiedListing properties to a copy of verified.
    if (!verified && !verifiedListing) return verified;
    return {...verified || {}, verifiedListing, json: {...(verified?.json || {}), ...(verifiedListing?.json || {})}};
  }
  static assign(target, {verified, ...properties}) {
    Object.assign(target, {verified, ...(verified?.json || {}), ...properties});
  }
  
  static async fetchData(tag, asUser) { // Get all the necessary peristed data, in verified format.
    const {collection, listingCollection} = this;
    const data = asUser ? await collection.retrieve({tag, member: null}) : ''; // Does not attempt to fetch/decode main/private data unless user is supplied
    const listingData = await listingCollection.retrieve?.({tag, member: null}) || '';
    const combined = await this.combinePublicPrivateData(data, listingData);
    return combined;
  }

  async getVerifiedPersistence(propertyNames, collection = this.constructor.collection, persistOptions) {
    // Persist as specified, promising the verified data.
    const tag = await this.persistProperties(propertyNames, collection, persistOptions);
    // TODO: Modify Flexstore to allow the client to capture this, rather than having to regenerate it.
    return await collection.retrieve(tag);
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
  async captureProperty(data, name) { // Adds value to data POJO IFF it should be stored.
    const value = await this[name]; // May be a rule that has not yet be resolved.
    // We generally don't want to explicitly store things that can be computed by rules, for canonicalization purposes (and size).
    // Lots of ways this could be done. This simple version just omits falsy and empty array.
    if (Array.isArray(value) && !value.length) return;
    // Note that if a value was meaningfully different as 0, '', false, [], this would fail to preserve that.
    if (!value) return;
    data[name] = value;
  }
}

// Additionally keeps track of the instances that have been ensured, fetched, or updated, so that fetch can return previously generated instances.
// The directory is a LiveSet that tracks (by tag) all the instances that have are known so far.
// (Compare with Flexstore Collections, which persists data but does not hold any instances.)
export class Enumerated extends Persistable {
  static async ensure({tag, ...properties} = {}) { // Cache instance and reuse.
    // N.B.: if tag is falsy, updateDirectory (and ensure) will return a promise that generates the tag by persisting the data.
    const cached = tag && this.directory.get(tag);
    if (cached) {
      // Constructing something twice with the same tag may be of questionable value.
      // However, we have to updateDirectory for new instances so that updates that come in from others will work, even if we do not fetch.
      // Given that, we might as well check here that there is an existing instance.
      this.assign(cached, properties); // without re-assigning tag
      return cached;
    }
    const instance = await super.ensure({tag, ...properties});
    return await instance.updateDirectory(tag);
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

  static get directory() {
    if (Object.hasOwn(this, '_directory')) return this._directory;
    return this._directory = new LiveSet();
  }
  updateDirectory(tag = this.tag) { // Cache this through tag.
    if (!tag) {
      const verified = this.verified;
      if (verified.then) return verified.then(verified => this.maybeSetCachedInstance(verified.tag));
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
}

// For VersionedCollections: 
// - ensure/fetch/update has the same semantics as for any Enumerated collection:
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
  static async update(tag, verified) { // Suitable for update handler of History.collection.itemEmitter (for which 'tag' is a the version hash).
    let subject = this.getSubject(verified);
    // Update the subject instance, which will reset any modified properties -- but only if this update is newer than what we have.
    const existing = await subject?.verified;
    const isLatest = !existing || this.collection.compareTimestamps(existing.protectedHeader, verified.protectedHeader) < 0;
    if (isLatest) subject = await super.update(verified.protectedHeader.sub, verified);
    // Ensure the version instance exists, so that rules watching the subject.versions will update.
    const versions = subject.versions;
    if (!versions.has(tag)) this.createCachedVersion(versions, tag, verified);
    return subject;
  }

  // All of the following three work regardless of whether 'this' is a subject or version.
  get subject() { // Answer the unique, dynamic cached subject instance representing the latest version of the top level tag.
    // The top level tag of a VersionedCollection is found in the verified.protectedHeader.sub (not the verified.tag). See version, below.
    return this.constructor.getSubject(this.verified);
  }
  get version() { // 
    const verified = this.verified;
    // The verified data is actually the the verified data of the version, such that the version.tag
    // is the hash by which the this particular version is stored in the StateCollection. The top level
    // tag of all version is found in the verified.protectedHeader.sub.
    const hash = verified.tag;
    const versions = this.subject.versions;
    let instance = versions.get(hash);
    if (instance) return instance;
    return this.constructor.createCachedVersion(versions, hash, verified);
  }
  get antecedent() { // Answer the previous version, ensuring that it is cached (or null if nothing before).
    const verified = this.verified;
    const {ant} = verified.protectedHeader;
    const collection = this.constructor.collection;
    if (!ant) return null;
    const versions = this.subject.versions;
    let instance = versions.get(ant);
    if (instance) return instance;
    const constructor = this.constructor;
    return constructor.collection.versions.retrieve(ant)
      .then(version => constructor.createCachedVersion(versions, ant, version));
  }

  // Implementation.
  static collectionType = VersionedCollection;
  versions = new LiveSet();
  static getSubject(verified) { // Return the top-level instance for the sub specified by the verified data.
    return this.directory.get(verified.protectedHeader.sub);
  }
  static createCachedVersion(versions, hash, verified) { // Construct a version and cache it in the specified LiveSet of versions (not in directory).
    const instance = new this({tag: hash, verified});
    versions.set(hash, instance);
    return instance;
  }
}

[Persistable, History].forEach(kind => Rule.rulify(kind.prototype));


////////////////////////////////
/// Application Classes
////////////////////////////////

export class Entity extends Enumerated { // A top level User or Group in FairShare
  get picture() { return ''; } // A media tag, or empty to use identicon.
  get tagBytes() { // The tag as Uint8Array(32). Used with xor to compute memberTag.
    return this.constructor.computeTagBytes(this.tag);
  }

  static computeTagBytes(tagString) { // tagString as Uint8Array(32).
    const size = 32;
    let uint8 = Credentials.decodeBase64url(tagString);
    if (uint8.length === size)  return uint8;
    const larger = new Uint8Array(size);
    larger.set(uint8);
    return larger;
  }
  static prefix = 'social.fairshare.';
  // properties are listed alphabetically, in case we ever allow properties to be automatically determined while retaining a canonical order.
  static listingProperties = ['picture', 'title'];
  static encrypt = true;
}

// Your own personas have non-empty devices on which it is authorized and groups to which it belongs.
// All users have title, picture, and interestingly, a map of secret prompt => hash of answer, so that you can authorize additional personas on the current device.
// There are instance methods to create/destroy and authorize/deauthorize,
// and create/destroyGroup and adopt/abandonGroup.
export class User extends Entity {
  static async create({tag, secrets, deviceName, bankTag, ...properties}) { // Promise a provisioned instance.
    // PERSISTS Credentials, then Groups, then User

    if (!tag) { // Make one
      properties.secrets = await this.setUpSecretsForClaiming(secrets);
      tag = await Credentials.createAuthor(secrets[0][0]); // TODO: make createAuthor create multiple KeyRecovery members.
      const deviceTag = await this.clearSecretsAndGetDevice(tag, secrets);
      properties.devices = {[deviceName]: deviceTag};
    }

    const user = await this.ensure({tag, bankTag, ...properties}); // will be persisted by adoptGroup, below.
    // Add personal group-of-one (for notes, and for receiving /welcome messages.
    await user.createGroup({tag, verifiedListing: ''}); // Empty verified keeps us from publishing the group to public directory.
    // Now add the specified bank.
    const bank = await FairShareGroup.fetch(bankTag, user);
    await bank.authorizeUser(user); // Requires that this be executed by someone already in that group!
    await user.adoptGroup(bank);
    return user;
  }
  async destroy({prompt, answer, author, owner}) { // Permanently removes this user from persistence.
    // PERSISTS Personal Group, then User and Credentials interleaved.
    // Requires prompt/answer because this is such a permanent user action.
    const {tag} = this;
    await this.preConfirmOwnership({prompt, answer});

    // Leave every group that we are a member of.
    for (let groupTag of this.groups) {
      // TODO: why does this have to be done in order (for-of, rather than parallel Promise.all/map)?
      const group = await FairShareGroup.fetch(groupTag);
      if ((group.users.length === 1) && (group.users[0] === this.tag)) { // last memember of group
	await this.destroyGroup(group);
      } else {
	await this.abandonGroup(group);
	await group.deauthorizeUser(this);
      }
    }

    // Get rid of User data from collections and LiveSets.
    await super.destroy({author, owner});

    // Get rid of credential.
    Credentials.setAnswer(prompt, answer); // Allow recovery key to be destroyed, too.
    await Credentials.destroy({tag, recursiveMembers: true});
    Credentials.setAnswer(prompt, null);
  }
  async createInvitation({bankTag = this.bankTag} = {}) { // As a user, create an invitation tag for another human to use to create an account.
    // The (private) user will exist and already be a member of its personal group, the specified bank, and a new pairwise chat group with the inviting user.
    // When the invitation is claimed, the claiming human will fill in the device/secrets and title.
    const userTag = await Credentials.createAuthor('-');
    await Credentials.changeMembership({tag: userTag, add: [this.tag]}); // User "this" needs to be a member to set things up.

    // Create user with personal group, and bank membership, but no listing.
    const user = await this.constructor.create({tag: userTag, verifiedListing: '', bankTag});
    
    const chat = await this.createGroup({verifiedListing: ''}); // Private group-of-2 for this sponsoring user and the new invitee.
    chat.authorizeUser(user);
    user.adoptGroup(chat); // Persists user, including the bankTag that will be needed during claim.

    await Credentials.changeMembership({tag: userTag, remove: [this.tag]}); // We will have no further need for access.
    this.constructor.directory.delete(userTag); // We don't want to keep the data around. (Messes up testing, too.)
    return userTag;
  }
  static async claim({secrets, deviceName, invitation, ...properties}) {
    const hashes = await this.setUpSecretsForClaiming(secrets);
    const userTag = await Credentials.claimInvitation(invitation, secrets[0][0]);
    const deviceTag = await this.clearSecretsAndGetDevice(userTag, secrets);
    const devices = {[deviceName]: deviceTag};

    const user = await User.fetch(userTag, {tag: userTag}); // Supply a dummy author so that we can decrypt the persisted bankTag.
    user.author = user;
    await user.edit({devices: {[deviceName]: deviceTag}, secrets: hashes, ...properties, verified: null}, user);
    return user;
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
    const {devices} = this;
    devices[deviceName] = deviceTag; // TODO?: Do we want to canonicalize deviceName order?
    await this.edit({devices}, this);
  }
  async deauthorize({prompt, answer, deviceName}) { // Remove this user from the set that I have private access to on the specified device.
    // PERSISTS Credential.
    // Requires prompt/answer so that we are sure that the user will still be able to recover access somewhere.
    await this.preConfirmOwnership({prompt, answer});
    const {tag, devices} = this;
    const deviceTag = devices[deviceName];  // Remove device key tag from user private data.
    delete devices[deviceName];
    await this.edit({devices}, this);

    await Credentials.changeMembership({tag, remove: [deviceTag]}); // Remove device key tag from user team.
    await Credentials.destroy(deviceTag)  // Might be remote: try to destroy device key, and swallow error.
      .catch(() => console.warn(`${this.title} device key set ${deviceTag} on ${deviceName} is not available from here.`));
    // fixme await this.abandonByTag(tag);
    return deviceTag; // Facilitates testing.
  }
  createGroup(properties) { // Promise a new group with this user as member
    return FairShareGroup.create({author: this, ...properties});
  }
  destroyGroup(group) { // Promise to destroy group that we are the last member of
    return group.destroy(this);
  }
  static latch = 0; // fixme
  async adoptGroup(group) {
    // Used by a previously authorized user to add themselves to a group,
    // changing both the group data and the user's own list of groups.
    // PERSISTS Group, then User
    await this.edit({groups: [...this.groups, group.tag]}, this);
    await group.adoptBy(this); // TODO: why does this sometimes fail in the other order?
  }
  async abandonGroup(group) {
    // Used by user to remove a group from their own user data.
    // PERSISTS User
    const groupTag = group.tag;
    return await this.edit({groups: this.groups.filter(tag => tag !== groupTag)}, this);
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

  get devices() { return {}; } // Map of deviceName => userDeviceTag so that user can remotely deauthorize.
  get groups() { return []; }  // Tags of the groups this user has joined.
  get bankTag() { return ''; } // Tag of the group that is used to access the reserve currency. (An element of groups.)
  get secrets() { return {}; } // So that we know what to prompt when authorizing, and can preConfirmOwnership.
  get shortName() { return this.title.split(/\s/).map(word => (word[0] || '-').toUpperCase()).join('.') + '.'; }
  get owner() { return this; } // User is its own owner.
  
  
  static listingProperties = ['picture', 'secrets', 'title'];
  static persistedProperties = ['bankTag', 'devices', 'groups'];
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
}

export class Group extends Entity {
  static async create({author, tag = Credentials.create(author.tag), ...properties}) { // Promise a new Group with user as member
    // PERSISTS Credential (unless provided), then Group, then User
    // userTag is authorized for newly create groupTag.
    tag = await tag;
    const group = await this.ensure({tag, author, ...properties}); // adoptGroup will persist it.
    await author.adoptGroup(group);
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
  async adoptBy(user) {
    // TODO: users should come from teamMembers. No reason for additional property. That MIGHT result in no privatGroup data at all.
    await this.edit({users: [...this.users , user.tag]}, user);
  }
  async authorizeUser(candidate) {
    // Used by any team member to add the user to the group's key set.
    // PERSISTS Credential
    // Note that it does not add the user to the Group data, as the user does that when they adoptGroup.
    // This aspect is different than deauthorizeUser.

    // IWBNI changeMembership removed duplicates
    const existing = await Credentials.teamMembers(this.tag);
    if (existing.includes(candidate.tag)) return null;

    return await Credentials.changeMembership({tag: this.tag, add: [candidate.tag]});
  }
  async deauthorizeUser(user, author = user) {
    // Used by any team member (including the user) to remove user from the key set AND the group.
    // PERSISTS Group then Credential
    // Does NOT change the user's data.
    await this.edit({users: this.users.filter(tag => tag !== user.tag)}, author);
    await Credentials.changeMembership({tag: this.tag, remove: [user.tag]});
  }

  get title() { // A string by which the group is known.
    if (this.users.length === 1) return "Yourself";
    return Promise.all(this.users.map(tag => User.fetch(tag).then(user => user.shortName)))
      .then(shorts => shorts.join(', '));
  }
  get users() { // A list of tags. TODO: compute from keyset recipients and don't persist? 
    return [];
  }
  get owner() { // Group data is owned by the group.
    return this;
  }

  static collectionType = VersionedCollection;
  static persistedProperties = ['users'];
}

export class Message extends History {
  // Has additional properties author, timestamp, and type, which are currently unencrypted in the header. (We may encrypt author tag.)
  // A lightweight immutable object, belonging to a group.

  // If not specified at construction, these are pulled from the verified persisted data - which better be assigned!
  get type() { // If a special mt (Message Type) was specified to indicate an action, use it. Otherwse a text message.
    return this.verified.protectedHeader.mt || 'text';
  }
  get owner() { // If signed with an iss or group specified, it is a group. Else a user.
    const {iss, group, act, individual, kid} = this.verified.protectedHeader;
    const groupTag = iss || group;
    if (groupTag) return FairShareGroup.fetch(groupTag);
    return User.fetch(individual || act || kid);
  }
  get author() { // Who send (signed) the message.
    const {act, kid} = this.verified.protectedHeader;
    return User.fetch(act || kid);
  }
  get timestamp() { // When was it signed, as a Date.
    return new Date(this.verified.protectedHeader.iat);
  }
  get persistOptions() { // Suply mt (Message Type) if not text, and maybe express iss differently for outsiders.
    const options = super.__persistOptions();
    // TODO? if author not owner and owner.users do not include author, should we change 'owner' claim to 'group'?
    if (this.type === 'text') return options;
    return {mt: this.type, ...options};
  }
  static encrypt = true;
}

// We don't actually instantiate different subclasses of Group. This break out is just for maintenance.
class MessageGroup extends Group { // Supports a history of messages.
  async send({type = 'text', ...properties}, author) { // Sends Messages as author.
    // PERSISTS Message, and sets its tag to the StateCollection hash/tag.
    const {tag} = this;
    const message = await Message.ensure({...properties, tag, type, author, owner: this});
    const verified = await message.persist();
    return verified;
  }
  // todo: update messages with new entries. test.
  async destroy(author) {
    // PERSISTS Messages, then User, then Group, then Credential
    const {tag} = this;
    await Message.collection.remove({tag, owner: tag, author: author.tag});
    Message.directory.delete(tag);
    await super.destroy(author);
  }
}

export class Member extends History { // Persists current/historical data for a user within a group.
  constructor(properties) {
    super(properties);
    this.liveVotes = new LiveSet(this.votes);
  }
  get balance() { return 0; }
  get lastStipend() { return 0; } // Must be assigned on creatiopn.
  get votes() { return {}; }  // A serialization of liveVotes. Just for persistence.
  get user() { return null; } // Assigned, and used for debugging. (Note that author is for persisting a transaction.)
  get verifiedMain() { // Also copy liveVotes into votes dictionary for persistence.
    const { votes } = this;
    this.liveVotes.forEach((value, key) => votes[key] = value);
    return super.__verifiedMain();
  }
  get title() { return this.user.title; } // TODO: remove. Makes for easier debugging, but wasteful of space.
  async persist(author, owner) {
    if (!owner?.tag && !this.owner?.tag) console.log(`persist with author ${author?.title}/${this.author?.title}, owner ${owner?.title}/${this.owner?.title}, user: ${this.user?.title}`);
    return super.persist(author, owner);
  }

  static persistedProperties = ['balance', 'lastStipend', 'votes'];
}

// TODO:
// - ensure each member for in-memory groups (e.g., only if one of our users is a member).
//   Add / remove when membership changes.
//   This is because...
// - rate and stipend should be a live average of member votes (skipping undefined votes)
// - Can we derive users from team now? (How does that work for personal group?)
// - vote to admit/expell member
// - connect messages with actions, bidirectionally, based on message type
//   examples:
//     /pay 10 @bob (by alice)
//     /rate 0.1 (by bob) => New rate 0.13
//     /admit @carol (by bob) => send /welcome Apples in carol's personal group
//     /expel @bob  (by alice) => send /goodbye Apples in bob's personal group
//   - A message localAction is method that assigns to rules within the group, and other rules update accordingly.
//   - When a Message update is earlier than the local latest, we set the Group and Members to the timestamp of the antecedent of the new message.
//     And then we act on all the later messages as if we were receiving them as updates.
//   - Regardless of what came before acting on an update OR sending a message causes the message action to fire.
//   - A message externalAction is a method that should only be fired once in a local send (after any localAction is fired), to execute any latched behavior.

class TokenGroup extends MessageGroup { // Operates on Members
  constructor(rest = {}) { // Add all Members. We can return a promise because every path to here runs through `await SomeClass.ensure(...)`.
    super(rest);
    return Promise.all(this.users.map(async userTag => {
      const memberTag = this.getMemberTag(userTag);
      const member = await Member.fetch(memberTag, true);
      Member.assign(member, {user: await User.fetch(userTag), group: this});
      this.members.set(userTag, member);
    })).then(() => this);
  }
  async adoptBy(user) { // Add a member for user, and persist it with the lastStipend.
    await super.adoptBy(user);
    const memberTag = this.getMemberTag(user.tag, user.tagBytes);
    const member = await Member.ensure({tag: memberTag, user, owner: this, lastStipend: Date.now()});
    this.members.set(user.tag, member);
    await member.persist(user);
  }
  // TODO? In both the following we destroy() the member. Should we keep it for posterity?
  async deauthorizeUser(user, author = user) { // Remove the associated Member, too.
    const member = this.members.get(user.tag);
    this.members.delete(user.tag);
    await member.destroy({author, owner: this});
    await super.deauthorizeUser(user, author);
  }
  async destroy(author) {
    // No need to remove entry from this.members because we are destroying the whole Group.
    await Promise.all(this.users.map(userTag => this.members.get(userTag).destroy({author, owner: this})));
    await super.destroy(author);
  }
  setSender(user) { // Set transaction sender as specified, so that dependencies update.
    this.sender = user ? this.members.get(user.tag) : null;
  }
  setReceiver(user) { // Set transaction receiver as specified, so that dependencies update.
    this.receiver = user ? this.members.get(user.tag) : null;
  }
  setVote(user, election, vote) { // Set the given users vote as specified for the given election. A vote of undefined indicates abstention.
    const live = this.members.get(user.tag).liveVotes;
    if (vote === undefined) live.delete(election);
    else live.set(election, vote);
  }

  // To transfer, assign sender, receiver, tick, and amount -- fee, costs, senderBalance, receiverBalance will update automatically.
  // Then commit with commitTransfer if desired.
  async commitTransfer(author) { // Persist sender, receiver, for current values of amount, tick, etc.
    // Note that tick is not updated, and so sender/receiver balances will be as displayed.
    // If the UI wants to, it can reset tick before calling this.
    const {tick, senderBalance, receiverBalance, sender, receiver} = this;
    this.maybeUpdateAuthor(author);
    const promises = [];
    if (sender) {
      sender.balance = senderBalance;
      sender.lastStipend = tick;
      promises.push(sender.persist(author));
    }
    if (receiver) {
      receiver.balance = receiverBalance;
      receiver.lastStipend = tick;
      promises.push(receiver.persist(author));
    }
    await Promise.all(promises);
  }

  async persist(authorx, ownerx, fixme) { // Also persist members
    const {author, owner, title} = this;
    //console.log('persiting', {title: await title, author: author.title, owner: await owner.title, authorx: authorx?.title, ownerx: ownerx?.title});
    //if (fixme)
    await Promise.all(this.members.map(member => { console.log('persist member', member); return member.persist(authorx, ownerx); }));
    //console.log('members persisted');
    const xx = await super.persist(authorx, ownerx);
    //if (fixme)
    //console.log('persisted', {title, author: author.title, owner: owner.title, authorx: authorx?.title, ownerx: ownerx?.title});
    return xx;
  }
  get rate() { // The tax rate charged by this Group, that goes to burned fee.
    return this.averageVotes('rate');
  }
  get stipend() { // The universal supplemental income minted each day for each member.
    return this.averageVotes('stipend');
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

  static persistedProperties = ['users'];
  members = new LiveSet();
  static MILLISECONDS_PER_DAY = 1e3 * 60 * 60 * 24;
  computeUpdatedBalance(member, increment) { // Compute what the balance would be, updating from stipend at tick.
    let tick = this.tick;
    let {balance = 0, lastStipend = tick} = member;
    const daysSince = Math.floor((tick - lastStipend) / this.constructor.MILLISECONDS_PER_DAY);
    const beforeRounding = balance + (this.stipend * daysSince) + increment;
    const rounded = this.roundDownToNearest(beforeRounding);
    return rounded;
  }
  roundUpToNearest(number, unit = this.divisions) { // Rounds up to nearest whole value of unit.
    return Math.ceil(number * unit) / unit;
  }
  roundDownToNearest(number, unit = this.divisions) { // Rounds up to nearest whole value of unit.
    return Math.floor(number * unit) / unit;
  }
  averageVotes(election) { // Return average of all the specified votes.
    let sum = 0, nVotes = 0;
    this.members.forEach(member => {
      if (!member.liveVotes.has(election)) return;
      nVotes++;
      sum += member.liveVotes.get(election);
    });
    if (nVotes) return sum / nVotes;
    return sum;
  }
  voteRate(user, rate) { // FIXME
  }
  static xorTagBytesToString(aBytes, bBytes) { // Return base64url of aBytes ^ bBytes
    const nBytes = 32;
    const result = new Uint8Array(nBytes);
    for (let i = 0; i < nBytes; i++) {
      result[i] = aBytes[i] ^ bBytes[i];
    }
    const tag = Credentials.encodeBase64url(result);
    return tag;
  }
  getMemberTag(userTag, userTagBytes = Entity.computeTagBytes(userTag)) { // Return the persistence tag for user within this group.
    // user.tag XOR group.tag
    if (userTag === this.tag) return this.tag; // Else it would be all zeros!
    return this.constructor.xorTagBytesToString(userTagBytes, this.tagBytes);
  }
}

export class FairShareGroup extends TokenGroup { // Application-level group with combined behavior.
}

// The default properties to be rullified are "any an all getters, if any, otherwise <something-ugly>".
// As it happens, each of these three defines at least one getter.
[Entity, User, Message, Group, Member, TokenGroup].forEach(kind => Rule.rulify(kind.prototype));
