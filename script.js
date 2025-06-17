import { App, MDElement,  BasicApp, AppShare, CreateUser, LiveCollection, MenuButton, LiveList, AvatarImage, AuthorizeUser,
	 UserProfile, EditUser, SwitchUser, AppQrcode, Rule, name as uname, version as uversion } from '@kilroy-code/ui-components';
import { Credentials, MutableCollection, ImmutableCollection, VersionedCollection, Collection, SharedWebRTC, name, version } from '@kilroy-code/flexstore';
import QrScanner from './qr-scanner.min.js';


const { localStorage, URL, crypto, TextEncoder, FormData, RTCPeerConnection, Notification } = window;

// Cleanup todo:
// - Set App.mumble vs App.resetUrl. Which to use? Be consistent.

const checkSafari = setTimeout(() => {
  App.alert('The Webworker script did not reload properly. It may have just been from a "double reload", in which case reload may fix it now. But there are browser bugs that also cause this (e.g., in Safari 18.3) in which the only workaround is to close the browser and restart it.',
	    "Webworker Bug!");
}, 6e3);
Credentials.ready.then(ready => {
  ready && clearTimeout(checkSafari);
  document.getElementById('distributedSecurity').innerText = `${ready.name} ${ready.version}`;
  document.getElementById('flexstore').innerText = `${name} ${version}`;
  document.getElementById('uicomponents').innerText = `${uname} ${uversion}`;
});

class User { // A single user, which must be one that the human has authorized on this machine.
  constructor(properties) { Object.assign(this, properties); }
  isLiveRecord = true;
  get title() { return 'unknown'; }
  get picture() { return ''; }
  get groups() { return []; }
  get notify() { return []; }
  getNotify(group) {
    const index = this.groups.indexOf(group);
    if (index < 0) return false;
    return this.notify[index];
  }
}
Rule.rulify(User.prototype);


class Group { // A single group, of which the current user must be a member.
  constructor(properties) { Object.assign(this, properties); }
  isLiveRecord = true;
  get title() { return 'unknown'; }
  get picture() { return ''; }
  get rate() { return 0.01; }
  get stipend() { return 1; }
  get divisions() { return 100; }
  get members() {
    return Object.keys(this.balances);
  }
  get balances() { return {}; }
  static millisecondsPerDay = 1e3 * 60 * 60 * 24;
  // For now, these next two are deliberately adding the user if not already present.
  getBalance(user) { // Updates for daily stipend, and returns the result.
    const { balances } = this;
    let data = balances[user] || {balance: this.stipend * 10}; // Just for now, start new users with some money.
    if (!data) return 0;
    const now = Date.now();
    let {balance, lastStipend = now} = data;
    const daysSince = Math.floor((now - lastStipend) / Group.millisecondsPerDay);
    balance += this.stipend * daysSince;
    balance = this.roundDownToNearest(balance);
    lastStipend = now;
    data = {balance, lastStipend};
    balances[user] = data;
    this.balances = balances; // Ensure that we reset the rule for balances, so dependecies update.
    return balance;
  }
  adjustBalance(user, amount) {
    let balance = this.getBalance(user);
    balance += amount;
    if (amount < 0) balance = this.roundDownToNearest(balance);
    else balance = this.roundUpToNearest(balance);
    this.balances[user].balance = balance;
  }
  roundUpToNearest(number, unit = this.divisions) { // Rounds up to nearest whole value of unit.
    return Math.ceil(number * unit) / unit;
  }
  roundDownToNearest(number, unit = this.divisions) { // Rounds up to nearest whole value of unit.
    return Math.floor(number * unit) / unit;
  }
}
Rule.rulify(Group.prototype);

/*
  The app maintains a LiveCollection for Users and another for Groups.

  The known tags of each is populated from a server at startup, calling LiveCollection.updateKnownTags.
  This causes the collection to start asking the server for a POJO record of the public data (e.g., title, picture) for each known tag using getUserData/getGroupData.
  These POJOs are kept in collection[tag].

  When we want to instead get a rule-based live model (a User or Group), the LiveCollection pulls this in with getUserModel/getGroupModel.
  Any changes pushed to us should effect the collection[tag], and the app takes it from there.
  App.setGroup/setUser are called to persist whole updated records, using setUserData/setGroupData, always on a tag for which we have a live model.
  The set of such live tags is updated with LiveCollection.updateLiveTags:
    The list of Users live tags are persisted in localStorage, and added to whenever we create or authorize a new user.
    The list of Group live tags is enumerated for each user, and added to whenever we create or join a new group.

  The public user and public group data are kept unencrypted in the "social.fairshare.users.public" and "social.fairshare.groups.public" collections.
  This is what getuserData/getGroupData pulls in.

  The private data are kept encrypted by their owners in the "social.fairshare.users.private" and "social.fairshare.groups.private" collections.
  The entire content of these items is encrypted (e.g., not just particular field values). This makes sense because only the owners would
  have any need to pull in such data in the first place.

  The protocol doesn't actually require a user or group to be listed in the public collections, but the app doesn't currently support that.
*/
const usersPublic   = new MutableCollection(  {name: 'social.fairshare.users.public'});
const usersPrivate  = new MutableCollection(  {name: 'social.fairshare.users.private'});
const groupsPublic  = new MutableCollection(  {name: 'social.fairshare.group.public'});
const groupsPrivate = new VersionedCollection({name: 'social.fairshare.groups.private'});
const messages = new VersionedCollection({name: 'social.fairshare.messages'});
const media         = new ImmutableCollection({name: 'social.fairshare.media'});

function addUnknown(collectionName) { // Return an update event handler for the specified collection.
  return async event => {
    try {
    const tag = event.detail.tag;
    const collection = App[collectionName];
    const live = collection.liveTags;
    // The 'update' event machinery cannot decrypt payloads for us, because the data might not be ours.
    // However, if it is one of our liveTags, then we certainly can (and must) decrypt it.
    if (live.includes(tag)) return collection.updateLiveRecord(tag, (await Collection.ensureDecrypted(event.detail)).json);

    // Otherwise, we only deal in public info. FIXME: is that true? What about encrypted media attachements to messages?
    const known = collection.knownTags;
    if (!known.includes(tag)) {
      return collection.updateKnownTags([...known, tag]); // Adding a new knownTag
    }
    // Otherwise just update the record without adding a new one.
      collection.updateKnownRecord(tag);
    } catch (e) {
      console.error(e.message);
      console.warn(e.stack);
    }
    return null;
  };
}
usersPublic.onupdate = addUnknown('userCollection');
usersPrivate.onupdate = addUnknown('userCollection');
groupsPublic.onupdate = addUnknown('groupCollection');
groupsPrivate.onupdate = addUnknown('groupCollection');
messages.versions.onupdate = ({detail}) => FairshareChatInput.instance.onupdate(detail);

const appCollections = [usersPublic, usersPrivate, groupsPublic, groupsPrivate, groupsPrivate.versions, messages, messages.versions, media];
const collections = Object.values(Credentials.collections).concat(appCollections);
Object.assign(window, {SharedWebRTC, Credentials, MutableCollection, Collection,
		       groupsPublic, groupsPrivate, usersPublic, usersPrivate, messages, media,
		       Group, User, collections}); // For debugging in console.
async function synchronizeCollections(service, connect = true) { // Synchronize ALL collections with the specified service, resolving when all have started.
  console.log(connect ? 'connecting' : 'disconnecting', service, new Date());
  try {
    if (connect) {
      const promises = collections.map(collection => collection.synchronize(service)); // start 'em all.
      await groupsPublic.synchronized;  // Once we're in production, we can hardcode this in the rule for FairShareTag,
      App.FairShareTag = await groupsPublic.find({title: 'FairShare'});
      return Promise.all(promises);
    }
    return Promise.all(collections.map(collection => collection.disconnect(service)));
  } catch (error) {
    console.error('synchronization error', error.message || error);
    console.log(error.stack);
    return null;
  }
}

function getUserList() { return usersPublic.list(); }
function getGroupList() { return groupsPublic.list(); }
async function getUserData(tag)  { return (await usersPublic.retrieve({tag}))?.json || ''; } // Not undefined.
async function getGroupData(tag) { return (await groupsPublic.retrieve({tag}))?.json || ''; }

async function setCombinedData(publicCollection, privateCollection, tag, data, author = Credentials.author) { // Split data into public and private parts, and save them with appropriate owner/encryption.
  const {title, picture = '', q0, a0, ...rest} = data;
  return Promise.all([
    publicCollection.store({title, picture, q0, a0}, {tag, author, owner: tag, encryption: ''}), // author will be Credentials.author
    privateCollection.store(rest, {tag, author, owner: tag, encryption: tag})
  ]);
}
function setUserData(tag, data)  { return setCombinedData(usersPublic, usersPrivate, tag, data, tag); }
function setGroupData(tag, data) { return setCombinedData(groupsPublic, groupsPrivate, tag, data); }

async function getCombinedData(publicCollection, privateCollection, tag) { // Get public and private data, and combine them.
  const [publicRecord, privateRecord] = await Promise.all([publicCollection.retrieve({tag}),
							   privateCollection.retrieve({tag})]);
  return Object.assign({}, publicRecord?.json || {}, privateRecord?.json || {});
}
async function getUserModel(tag) {
  return new User(await getCombinedData(usersPublic, usersPrivate, tag));
}
async function getGroupModel(tag) {
  return new Group(await getCombinedData(groupsPublic, groupsPrivate, tag));
}

class FairshareApp extends BasicApp {
  constructor(...rest) {
    super(...rest);
    // SUBTLE
    // We want to read locally stored collection lists and allow them to be set from that, BEFORE
    // the default liveMumbleEffect rules fire during update (which fire on the initial empty values if not already set).
    // So we're doing that here, and relying on content not dependening on anything that would cause us to re-fire.
    // We will know the locally stored tags right away, which set initial liveTags and knownTags, and ensure that there is
    // a null record rule in the collection that will be updated when the data comes in.
    this.userCollection.updateLiveTags(this.getLocal(this.localKey(usersPrivate), []));
  }
  afterInitialize() {
    super.afterInitialize();

    // When we get the list from the network, it will contain those initial knownTags members from above
    // (unless deleted on server!), and when it comes in, that will (re-)define the total knownTags order.
    getUserList().then(knownTags => this.userCollection.updateKnownTags(knownTags));
    getGroupList().then(knownTags => this.groupCollection.updateKnownTags(knownTags));

    const groupMenuButton = this.child$('#groupMenuButton');
    const groupMenuScreens = Array.from(this.querySelectorAll('[slot="additional-screen"]'));
    groupMenuButton.collection = new LiveCollection({
      records: groupMenuScreens
    });
    // See assignment in synchronizeCollections(). This one covers the case where
    // synchronization has been turned off.
    if (!groupsPublic.synchronizers.size) groupsPublic.find({title: 'FairShare'}).then(tag => this.FairShareTag = tag);
  }
  get statusElement() {
    return this.child$('[slot="additional-menu"]');
  }
  noCurrentUser(heading = "No authorized user") {
    App.alert("You must either authorize as an existing member, or obtain an unused invitation from a member.",
	      heading);
    App.resetUrl({screen: 'Add existing account', invitation: ''});
  }
  get userCollection() { // The FairshareApp constructor gets the liveTags locally, before anything else.
    const users = new LiveCollection({getRecord: getUserData, getLiveRecord: getUserModel});
    users['0'] = {title: 'New user'}; // Hack
    return users;
  }
  get liveUsersEffect() { // If this.userCollection.liveTags changes, write the list to localStorage for future visits.
    return this.setLocal(this.localKey(usersPrivate), this.userCollection.liveTags);
  }
  getUserTitle(key = App.user) { // Name of the specified user.
    return this.userCollection[key]?.title || key;
  }
  get groupCollection() { // As with userCollection, it is stable as a collection, but with liveTags changing.
    return new LiveCollection({getRecord: getGroupData, getLiveRecord: getGroupModel});
  }
  get group() {
    return this.user && (this.getParameter('group') || this.userRecord?.groups?.[0]) || '';
  }
  get groupRecord() {
    const {group, groupCollection} = this;
    return group ? groupCollection.updateKnownRecord(group) : null;
  }
  getGroupTitle(key = App.group) { // Callers of this will become more complicated when key is a guid.
    return this.groupCollection[key]?.title || key;
  }
  findGroup(properties) { // Can be overwritten by applications if they have a more complete picture of things elsewhere.
    return this.groupCollection.knownTags.find(tag => {
      const record = this.groupCollection[tag];
      for (let key in properties) {
	if (record[key] !== properties[key]) return false;
      }
      return true;
    });
  }
  get FairShareTag() {
    return ''; // Overrwritten at startup. Until then, empty.
  }
  get title() {
    return 'FairShare';
  }
  get payee() {
    return this.getParameter('payee');
  }
  get amount() {
    return parseFloat(this.getParameter('amount') || '0');
  }
  async createUserTag(editUserComponent) { // Promise a tag for the user, authorizing it with editUserComponent question/answer, and creating the team if it doesn't already exist as an invitation.
    const prompt = editUserComponent.questionElement.value;
    const answer = editUserComponent.answerElement.value;
    Credentials.setAnswer(prompt, EditUser.canonicalizeString(answer));
    const invitation = App.getParameter('invitation');
    if (invitation) {
      // This is a bit crazy, but as a side effect of claiming an invtation, we must make sure that the invitation is removed
      // from the url so that we don't get issues as a result of using a dead invitation.
      App.resetUrl({invitation: ''});
      return await Credentials.claimInvitation(invitation, prompt);
    }
    const tag = await Credentials.createAuthor(prompt);
    await FairshareGroups.addToOwner(tag);
    return tag;
  }
  localKey(collection) {
    return `${collection.name}:${collection.dbVersion}`;
  }
  setLocal(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  }
  getLocal(key, defaultValue = null) {
    const local = localStorage.getItem(key);
    return (local === null) ? defaultValue : JSON.parse(local);
  }
  mergeData(oldRecord, newData) {
    const data = {};
    oldRecord ||= {};
    // Essentially Object.assign({}, oldData, newData), but includes inherited data.
    for (const key in oldRecord) data[key] = oldRecord[key];
    for (const key in newData) data[key] = newData[key];
    delete data.isLiveRecord;
    return data;
  }
  async mediaTag(picture, options = {}) { // Store picture in media if neeed, and in any case return the string appropriate to user/group data.
    if (!picture || !picture.startsWith('data:')) return picture;
    const hash = await Credentials.hashText(picture);
    const tag = Credentials.encodeBase64url(hash);
    if (await media.get(tag)) return tag;
    return await media.store(picture, {tag, ...options});
  }
  get setUser() { // TODO: change these two names (one in ui-components), to something implying that data will be merged and saved. (Do they really have to be rules?)
    return async (tag, newData) => {
      const oldData = this.userCollection[tag];
      const merged = this.mergeData(oldData, newData);
      merged.picture = await this.mediaTag(merged.picture, {owner: '', author: tag});
      return setUserData(tag, merged);
    };
  }
  get setGroup() {
    return async (tag, newData) => {
      const oldData = this.groupCollection[tag];
      const merged = this.mergeData(oldData, newData);
      delete merged.members; // for now, let it be generated by rule
      merged.picture = await this.mediaTag(merged.picture);
      return setGroupData(tag, merged);
    };
  }
  static initialSync = null;
  getPictureURL(string) {
    if (!string) return '';
    if (/^(data:|http|\.\/)/.test(string)) return string;
    // tag in media collection
    return FairshareApp.initialSync
      .then(() => media.retrieve({tag: string}))
      .then(verified => verified.text); // A data: url string.
  }

  get userEffect() {
    return Credentials.author = this.user || '';
  }
  get userRecordEffect() {
    const {userRecord, groupCollection} = this;
    const groups = userRecord?.groups;
    return groupCollection.updateLiveTags(groups || []); // Ensures that there are named rules for each group.
  }
  // get groupRecordEffect() {
  //   return Credentials.owner = this.groupRecord?.owner || '';
  // }
  get groupEffect() {
    this.resetUrl({group: this.group});
    return Credentials.owner = this.group || '';
  }
  get amountEffect() {
    return this.resetUrl({amount: this.amount});
  }
  get payeeEffect() {
    return this.resetUrl({payee: this.payee});
  }
  select(key) { // First some special cases, and then the screen selection from our ui-components superclass.
    if (key === 'Group actions...') return this.$('#groupMenuButton').button.click();
    if (key === 'User actions...') return this.$('#user').button.click();

    if (key === 'Panic-Button...') return App.confirm('Delete all local data from this browser? (You will then need to "Add existing account" to reclaim your data from a relay.)', "Panic!").then(async response => {
      if (response !== 'ok') return;
      // TODO: Also need to tell Credentials to destroy the device keys, which are in the domain of the web worker.
      console.clear();
      console.log('Removing local databases:', ...collections.map(c => c.name));
      localStorage.clear(); // the important one is after disconnect/destroy, but if it hangs, let's at least have this much done.

      navigator.serviceWorker.controller.postMessage('clearSourceCache');
      await Promise.all(appCollections.map(async c => {
	await c.disconnect();
	const store = await c.persistenceStore;
	await store.destroy();
      }));
      await Credentials.Storage.destroy();

	localStorage.clear(); // again, because disconnect tickles relays.
      console.log('Cleared');
    });

    // TODO: there is at least one menu click handler that is going down this path without being for screens. It would be
    // nice if that didn't propogate here.
    if (key?.startsWith('Run ')) return window.open("test.html", "_blank");

    if (!this.user && !this.getParameter('invitation')) return this.noCurrentUser();
    super.select(key);
    return null;
  }
}
FairshareApp.register();

class GroupImage extends AvatarImage {
  get collectionName() {
    return 'groupCollection';
  }
  get tag() {
    return App.group;
  }
  get radius() {
    return 10;
  }
}
GroupImage.register();

class FairshareGroupsMenuButton extends MenuButton { // Choose among this user's groups.
  // Appears in share, payme, and pay as an opportunity for the user to change their current group.
  get collection() {
    return App.groupCollection;
  }
  get tags() { // Changes as the user changes.
    // return this.userRecord?.groups || [];  // alternative
    return this.collection?.liveTags || [];
  }
  get choice() {
    return App.group;
  }
  select(tag) { // When a choice is made, it becomes the current group.
    App.resetUrl({group: tag, payee: '', amount: ''}); // Clear payee,amount when switching.
  }
  get groupRecordEffect() { // Set the button label to match current group record.
    const title = App.groupRecord?.title;
    if (!title) return '';
    return this.button.textContent = title;
  }
}
FairshareGroupsMenuButton.register();

class FairshareAllOtherGroupsMenuButton extends MenuButton { // Choose among other groups to join.
  get collection() {
    return App.groupCollection;
  }
  get choice() {
    return '';
  }
  get choiceRecord() {
    const {choice, collection} = this;
    if (!choice) return null;
    collection.updateKnownRecord(choice); // Ensure a rule for choice.
    return collection[choice] || null;
  }
  get choiceEffect() {
    const { choiceRecord } = this;
    return this.button.textContent = choiceRecord?.title || "Select a group";
  }
  get tags() {
    const collection = this.collection;
    if (!collection) return [];
    const live = new Set(collection?.liveTags);
    return collection.knownTags.filter(tag => !live.has(tag));
  }
}
FairshareAllOtherGroupsMenuButton.register();

class FairshareAmount extends MDElement { // Numeric input linked with App.amount.
  get placeholder() {
    return App.groupRecord?.title || '';
  }
  get placeholderEffect() {
    return this.element.placeholder = this.placeholder;
  }
  get template() {
    return `<md-outlined-text-field label="Amount" name="amount" type="number" min="0" step="0.01"></md-outlined-text-field>`;
  }
  get element() {
    return this.shadow$('md-outlined-text-field');
  }
  get amountEffect() {
    this.element.value = App.amount || '';
    return true;
  }
  afterInitialize() {
    super.afterInitialize();
    this.element.addEventListener('change', event => event.target.reportValidity() && (App.amount = parseFloat(event.target.value || '0')));
  }
}
FairshareAmount.register();

class FairshareAuthorizeUser extends AuthorizeUser {
  onaction() { // Capture q/a now, while we have 'this', in case super proceedes to adopt.
    const prompt = this.userRecord.q0;
    const answer = this.answerElement.value;
    Credentials.setAnswer(prompt, EditUser.canonicalizeString(answer));
    super.onaction();
  }
  static async adopt(tag) { // Create and add a device tag using q/a, and "wear" the new tag so we can author the user item changes in super.
    if (!tag) return '';
    const deviceTag = await Credentials.create();
    await Credentials.changeMembership({tag, add: [deviceTag]});
    Credentials.author = tag;
    return super.adopt(tag);
  }
}
FairshareAuthorizeUser.register();


class FairshareSwitchUser extends SwitchUser {
  select(tag) { // Before switching users, switch the group to one of theirs if necessary, so that the usr doesn't try adopt.
    if (!App.userCollection[tag].groups.includes(App.group)) {
      App.resetUrl({group: App.FairShareTag});
    }
    super.select(tag);
  }
}
FairshareSwitchUser.register();

class FairshareOpener extends MDElement {
}
FairshareOpener.register();

class FairshareGroups extends LiveList {
  static async addToOwner(userTag, groupTag = App.FairShareTag) { // Adds userTag to the owning team of group, of which we must be a member.
    await Credentials.changeMembership({tag: App.groupCollection[groupTag].owner, add: [userTag]});
    return groupTag;
  }
  static async adopt(groupTag) { // Add user to group data and group to user's data, updates live records, and makes group active.
    // Requires group to exist, and userTag to be a member of owning team.
    // Requires Credential.author to be set.
    if (!groupTag) return;
    const groups = App.userRecord?.groups || [];
    if (groups.includes(groupTag)) return;
    groups.push(groupTag);

    // Update persistent and live group data (which the user doesn't have yet):
    const groupRecord = await App.groupCollection.getLiveRecord(groupTag);
    if (groupRecord.title === 'unknown') {
      App.alert(`No viable record found for ${groupTag}.`);
      return;
    }
    App.groupCollection.updateKnownRecord(groupTag, groupRecord);
    groupRecord.getBalance(App.user); // For side-effect of entering an initial balance
    Credentials.owner = groupRecord.owner; // Will happen anyway on next tick, from changing group. But we need it now to save.
    await App.setGroup(groupTag, groupRecord); // Save with our presence.
    App.groupCollection.updateLiveTags(groups);  // See comments in AuthorizeUser.adopt.

    // Update persistent and live user data (which the user does have):
    await App.setUser(App.user, {groups});
    await App.userCollection.updateLiveRecord(App.user);
    App.resetUrl({group: groupTag, screen: App.defaultScreenTitle,
		  payee: '', amount: '', invitation: ''}); // Clear N/A stuff.
  }
  get imageTagName() {
    return 'group-image';
  }
  get collection() {
    return App.groupCollection;
  }
  get active() {
    return App.group;
  }
  select(tag) {
    App.resetUrl({group: tag, payee: '', amount: ''}); // Clear payee,amount when switching.
  }
}
FairshareGroups.register();

class FairshareJoinGroup extends MDElement {
  get otherGroupsElement() {
    return this.shadow$('fairshare-all-other-groups-menu-button');
  }
  get joinElement() {
    return this.shadow$('md-filled-button');
  }
  get choiceEffect() {
    return this.joinElement.toggleAttribute('disabled', !this.otherGroupsElement.choice);
  }
  activate() {
    const invitation = App.getParameter('igroup');
    if (!invitation) return;
    this.otherGroupsElement.choice = invitation;
  }
  afterInitialize() {
    super.afterInitialize();
    this.joinElement.addEventListener('click', async event => {
      const button = event.target;
      const menu = this.otherGroupsElement;
      const choice = menu.choice;
      button.toggleAttribute('disabled', true);
      App.resetUrl({igroup: ''});
      await FairshareGroups.adopt(choice);
      menu.choice = '';
      button.toggleAttribute('disabled', false);
      return true;
    });
  }
  get template() {
    return `
      <section>
        <p>Once you are a in FairShare, you can then be <a href="#Invite someone">invited</a> into another group.</p>
        <p>When we have messages, <fairshare-all-other-groups-menu-button disabled></fairshare-all-other-groups-menu-button> will allow
        you to submit a request to join. For now, this is where an invitation is redeemed (with the group chooser dropdown filled in for you and disabled).</p>
        <md-filled-button disabled>join</md-filled-button>
     </section>
    `;
  }
  get styles() {
    return `
      section { margin: var(--margin, 10px); }
      p fairshare-all-other-groups-menu-button { vertical-align: bottom; }
    `;
  }
}
FairshareJoinGroup.register();
  
class FairshareShare extends AppShare {
  async generateUrl(user, igroup) {
    if (!user) return '';
    let invitation = '';
    if (user === '0') {
      invitation = await Credentials.createAuthor('-');
      user = igroup = '';
    }
    await FairshareGroups.addToOwner(invitation || user, igroup || App.FairShareTag);
    const url = App.urlWith({user, invitation, igroup, group: '', payee: '', amount: '', screen: 'Join existing group'});
    console.log(url.href);
    return url;
  }
  get url() {
    return this.generateUrl(this.userElement.choice, this.groupElement.choice);
  }
  get description() {
    return `\nCome join ${App.getUserTitle()} in ${App.getGroupTitle()}!`;
  }
  get picture() {
    return App.getPictureURL(App.groupRecord?.picture);
  }
  get userElement() {
    return this.child$('all-users-menu-button');
  }
  get groupElement() {
    return this.child$('fairshare-groups-menu-button');
  }
/*  get buttonChoicesEffect() {
    const userTag = this.userElement.choice,
	  userRecord = App.userCollection[userTag],
	  userTitle = userRecord?.title,
	  isNewUser = userTag === '0',
	  groupTag = this.groupElement.choice,
	  groupRecord = App.groupCollection[groupTag],
	  groupTitle = groupRecord?.title,
	  isFairShare = groupTag === App.FairShareTag;
    if (isNewUser) { // New users can only go to the FairShare group.
      if (!isFairShare) {
	setTimeout(() => this.groupElement.select(App.FairShareTag));
      }
    } else if (groupRecord?.members?.includes(userTag)) {
      for (const candidateGroup of this.groupElement.tags) {
	const record = App.groupCollection[candidateGroup];
	if (!record?.members?.includes(userTag)) {
	  setTimeout(() => this.groupElement.select(candidateGroup));
	}
      }
      App.alert(`Existing user (${App.getUserTitle()}) is already a member of all your groups.`)
	.then(() => setTimeout(() => this.userElement.choice = 0));
    }
    return true;
  }*/
}
FairshareShare.register();

class FairsharePayme extends AppShare {
  get url() {
    return App.urlWith({user: '', payee: App.user, amount: App.amount || '', screen: 'Pay'});
  }
  get description() {
    return App.amount ?
      `\nPlease pay ${App.amount} ${App.getGroupTitle()} to ${App.getUserTitle()}.` :
      `\nPlease pay ${App.getGroupTitle()} to ${App.getUserTitle()}.`;
  }
  get picture() {
    return App.getPictureURL(App.userCollection[App.user]?.picture);
  }
}
FairsharePayme.register();

class FairshareGroupMembersMenuButton extends MenuButton { // Chose among this group's members.
  get collection() {
    return App.userCollection;
  }
  get groupRecord() {
    return App.groupRecord;
  }
  get tags() {
    return this.groupRecord?.members || [];
  }
  get choiceEffect() { // Empties choice if not a member, and updates display to match final choice.
    if (this.choice && this.groupRecord && !this.groupRecord.members?.includes(this.choice)) this.choice = '';
    const record = this.choice && this.collection[this.choice];
    return this.button.textContent = record?.title || 'Select member';
  }
}
FairshareGroupMembersMenuButton.register();

const LOCAL_TEST = false; // True if looping back on same machine by reading our own qr codes as a self2self test.
class FairshareSync extends MDElement {
  get sendCode() { return this.shadow$('#sendCode'); }
  get receiveCode() { return this.shadow$('#receiveCode');}   
  get sendVideo() { return this.shadow$('slot[name="sendVideo"]').assignedElements()[0]; }
  get receiveVideo() { return this.shadow$('slot[name="receiveVideo"]').assignedElements()[0]; }
  get sendInstructions() { return this.shadow$('#sendInstructions'); }
  get receiveInstructions() { return this.shadow$('#receiveInstructions'); }
  get qrProceed() { return this.shadow$('#qrProceed'); }
  get dummy() { return this.shadow$('#dummy'); }
  hide(element) { element.style.display = 'none'; }
  show(element) {
    element.style.display = '';
    element.toggleAttribute('disabled', false);
  }
  updateText(element, text) {
    this.show(element);
    element.textContent = text;
  }
  showCode(element, data) { // Show data on the qr code display specified by element.
    const colWidth = this.shadow$('.column').offsetWidth;
    const width = window.innerWidth - 10;
    const height = window.innerHeight - 10;
    const min = Math.min(colWidth, width, height, 450);
    element.size = min;
    element.sendObject(data);
    this.show(element);
  }
  scrollElement(element) { // Scroll element into view.
    setTimeout(() => element.scrollIntoView({block: 'end', behavior: 'smooth'}), 750);
  }
  async scan(view, onDecodeError = _ => _, localTestQrCode = null) { // Scan the code at view, unless a local app-qrcode is supplied to read directly.
    // Returns a promise for the JSON-parsed scanned string
    function decompress(data) {
      return AppQrcode.decompressObject(data);
    }
    if (localTestQrCode) {
      await new Promise(resolve => setTimeout(resolve, 4e3)); // Simulate scanning time.
      const generator = await localTestQrCode.generator;
      const blob = await generator.getRawData('svg');
      return await decompress(await QrScanner.scanImage(blob));
    }
    return new Promise(resolve => {
      let gotError = false;
      const scanner = new QrScanner(view,
				    result => {
				      scanner.stop();
				      scanner.destroy();
				      resolve(decompress(result.data));
				    }, {
				      onDecodeError,
				      highlightScanRegion: true,
				      highlightCodeOutline: true,
				    });
      scanner.start();
    });
  }
  afterInitialize() {
    super.afterInitialize();
    const relays = App.getLocal('relays', [
      ["Public server", new URL("/flexstore/sync", location).href, "checked"],
      ["Private WAN - Lead", new URL("/flexstore/signal/answer/some-secret", location).href],
      ["Private WAN - Follow", new URL("/flexstore/signal/offer/some-secret", location).href],
      ["Private LAN - Lead", "generate QR code on hotspot"],
      ["Private LAN - Follow", "scan QR code on hotspot"]
    ]);
    const relayElements = relays.map(params => this.addRelay(...params));
    FairshareApp.initialSync = Promise.all(this.updateRelays(relayElements));
    this.addExpander();
    this.shadow$('[href="#"]').onclick = () => {
      this.ssidElement.value = localStorage.getItem('ssid') || '';
      this.hotPassElement.value = localStorage.getItem('hotPass') || '';
      this.shadow$('#hotspotCredentialsDialog').show();
    };
    this.shadow$('#hotspotCredentialsForm').onsubmit = () => this.saveHotspotCredentials();
    this.qrProceed.onclick = () => this.proceed?.();
    App.statusElement.onclick = () => App.resetUrl({screen: 'Relays'});
    document.addEventListener('visibilitychange', () => {
      console.log('visibility:', document.visibilityState);
      if (document.visibilityState !== 'visible') return;
      setTimeout(() => { // Give the network a moment to do what it needs to.
	let elements = Array.from(this.relaysElement.children);
	App.getLocal('relays', []).forEach(([name, url, on], index) => on && (elements[index].children[0].checked = true));
	this.updateRelays(elements);
      }, 1e3);
    });
  }
  get ssidElement() {
    return this.shadow$('#ssid');
  }
  get hotPassElement() {
    return this.shadow$('#hotPass');
  }
  get url() { // Picked up by hotspotCode
    return '';
  }
  saveHotspotCredentials() {
    localStorage.setItem('ssid', this.ssidElement.value);
    localStorage.setItem('hotPass', this.hotPassElement.value);
    this.shadow$('#hotspotCode').data = `WIFI:S:${this.ssidElement.value};T:WPA;P:${this.hotPassElement.value};;`;
    this.shadow$('#hotspotQRDialog').show();
  }
  get relaysElement() {
    return this.shadow$('md-list');
  }
  addExpander() {
    this.addRelay("Your label", 'URL of shared server or private rendevous', 'indeterminate', 'disabled');
  }
  addExpanderIfNeeded() { // And return the list of items NOT including the expander
    const items = Array.from(this.relaysElement.children);
    const last = items.pop();
    if (!last.children[2].textContent.startsWith('URL of shared')) {
      last.firstElementChild.checked = true;
      last.firstElementChild.indeterminate = false;
      last.firstElementChild.removeAttribute('disabled');
      last.lastElementChild.lastElementChild.removeAttribute('disabled');
      items.push(last);
      this.addExpander();
    }
    return items;
  }
  saveRelays() {
    let data = [];
    let items = this.addExpanderIfNeeded();
    for (const child of items) {
      const [checkbox, label, url] = child.children;
      data.push([label.textContent, url.textContent, checkbox.checked ? 'checked' : null]);
    }
    App.setLocal('relays', data);
  }
  updateRelays(relayElements) {
    return relayElements.map(relayElement => this.updateRelay(relayElement));
  }
  async updateRelay(relayElement) { // Return a promise the resolves when relayElement is connected (if checked), and updated with connection type.
    const [checkbox, label, urlElement, trailing] = relayElement.children;
    const [status, connection, kill] = trailing.children;
    const lead = Credentials.collections.EncryptionKey;
    let url = urlElement.textContent;

    // These two wacky special cases are for LAN connections by QR code.
    if (label.textContent.includes('LAN - Lead')) {
      url = 'signals'; // A serviceName of 'signals' tells the synchronizer to createDataChannel and start negotiating.
      if (checkbox.checked) { // Kick off negotiation for sender's users.
	if (lead.synchronizers.get(url)) return; // Already started.
	synchronizeCollections(url, true);
	const sender = lead.synchronizers.get(url);

	this.updateText(this.sendInstructions, 'Check "Private LAN - Follow" on the other device, and use it to read this qr code:');
	const signals = await sender.connection.signals;
	this.showCode(this.sendCode, signals);
	this.show(this.qrProceed);
	this.scrollElement(this.qrProceed);

	await new Promise(resolve => this.proceed = resolve);
	if (!checkbox.checked) return; // User gave up.
	this.hide(this.sendCode);
	this.hide(this.qrProceed);
	this.show(this.sendVideo);
	this.updateText(this.sendInstructions, "Use this video to scan the qr code from the other device:");
	this.scrollElement(this.sendVideo);
	checkbox.checked = true;
	const scan = await this.scan(this.sendVideo.querySelector('video'),
				     _ => _,
				     LOCAL_TEST && this.receiveCode);
	if (!checkbox.checked) return; // User gave up.
	await sender.completeSignalsSynchronization(scan);
	this.hide(this.sendInstructions);
	this.hide(this.sendVideo);
      } else { // Disconnect
	if (!lead.synchronizers.get(url)) return;
	await synchronizeCollections(url, false);
	this.hide(this.sendInstructions);
	this.hide(this.sendCode);
	this.hide(this.sendVideo);
	this.hide(this.qrProceed);
	this.proceed?.();
      }

    } else if (label.textContent.includes('LAN - Follow')) {
      url = relayElement.url; // If we've received signals from the peer, they have been stashed here.
      if (checkbox.checked) { // Scan code.
	if (lead.synchronizers.get(url)) return; // Already started
	this.show(this.receiveVideo);
	this.updateText(this.receiveInstructions, "Use this video to scan the qr code from the other device:");
	this.scrollElement(this.receiveVideo);
	url = relayElement.url = await this.scan(this.receiveVideo.querySelector('video'),
					   _ => _,
					   LOCAL_TEST && this.sendCode);
	if (!checkbox.checked) return; // Because the user gave up on scanning and unchecked us.
	synchronizeCollections(url, true);
	const receiver = lead.synchronizers.get(url);
	this.updateText(this.receiveInstructions, `Press "scan other device's code" button on the other device, and use it to read this qr code:`);
	this.showCode(this.receiveCode, await receiver.connection.signals);
	this.hide(this.receiveVideo);
	this.show(this.dummy);
	this.scrollElement(this.dummy);
	await receiver.startedSynchronization;
	this.hide(this.dummy);
	this.hide(this.receiveInstructions);
	this.hide(this.receiveCode);
      } else { // Disconnect
	if (!lead.synchronizers.get(url)) return;
	await synchronizeCollections(url, false);
	this.hide(this.receiveInstructions);
	this.hide(this.receiveCode);
	this.hide(this.receiveVideo);
	relayElement.url = null;
      }

    } else if (checkbox.checked && lead.synchronizers.get(url)) {
      console.log(`Service ${url} is underway.`);
      return; // Already started.
    } else if (!checkbox.checked && !lead.synchronizers.get(url)) {
      return;
    } else {
      synchronizeCollections(url, checkbox.checked);
    }
    status.textContent = 'cloud_off';
    connection.textContent = '';
    if (!checkbox.checked) return;
    // We are connecting...
    App.statusElement.textContent = status.textContent = 'cloud_upload';
    const synchronizers = collections.map(collection => collection.synchronizers.get(url));
    // Once connected, show that we're synchronizing and display the connection protocol/type.
    Promise.race(synchronizers.map(synchronizer => synchronizer.startedSynchronization)).then(() => {
      App.statusElement.textContent = status.textContent = 'cloud_sync';
      const [synchronizer] = synchronizers;
      connection.textContent = `${synchronizer?.protocol || ''} ${synchronizer?.candidateType || ''}`;
      kill.style = 'display:none';
    });
    // Once synchronized, show that we're done.
    Promise.all(collections.map(collection => collection.synchronized)).then(() => {
      App.statusElement.textContent = status.textContent = 'cloud_done';
    });
    // Once closed (which might be the other end closing), indicate the change, and formally disconnect.
    Promise.race(synchronizers.map(synchronizer => synchronizer.closed)).then(() => {
      checkbox.checked = false;
      status.textContent = 'cloud_off';
      // Set App.statElement to alert, and then a moment later, reset it to on if any relays are on, else off.
      const alert = 'thunderstorm';      
      App.statusElement.textContent = alert;
      connection.textContent = '';
      kill.style = '';
      synchronizeCollections(url, false);
      setTimeout(() => {
	if (App.statusElement.textContent !== alert) return; // If something has changed it, leave it be.
	const someDone = Array.from(this.relaysElement.children).some(element => element.querySelector('material-icon').textContent === 'cloud_done');
	App.statusElement.textContent = someDone ? 'cloud_done' : 'cloud_off';
      }, 2e3);
    });
  }
  addRelay(label, url, state = '', disabled = '') {
    this.relaysElement.insertAdjacentHTML('beforeend', `
<md-list-item>
  <md-checkbox slot="start" ${state || ''} ${disabled}></md-checkbox>
  <span slot="headline" contenteditable="plaintext-only">${label}</span>
  <span slot="supporting-text"  contenteditable="plaintext-only">${url}</span>
  <span slot="trailing-supporting-text">
   <material-icon>cloud_off</material-icon>
   <span></span>
   <md-icon-button  ${disabled}><material-icon>delete</material-icon></md-icon-button>
  </span>
</md-list-item>`);
    const item = this.relaysElement.lastElementChild;
    const [checkbox, text, location, trailing] = item.children;
    const [remove] = trailing.children;
    checkbox.oninput = async event => {
      const element = event.target.parentElement,
	    checkbox = element.children[2];
      await this.updateRelay(element);
      if (checkbox.textContent.includes('/sync')) this.saveRelays();
    };
    text.onblur = location.onblur = event => this.saveRelays();
    remove.onclick = () => this.saveRelays(item.remove());
    return item;
  }
  get template() {
    // We tell browsers (particularly Safari) not to preload the audio stream, because it can result in the page appearing to not be loaded.
    return `
      <section>
        <md-list>
        </md-list>
        <!-- See also https://gist.github.com/novwhisky/8a1a0168b94f3b6abfaa https://fmstream.org/index.php?c=FT -->
        <p><a href="#">Share your hotspot</a> <audio src="https://npr-ice.streamguys1.com/live.mp3" preload="none" controls></audio></p>

        <div class="column">
          <p id="sendInstructions"></p>
          <app-qrcode id="sendCode" style="display:none"></app-qrcode>
          <slot name="sendVideo"></slot>
          <md-outlined-button id="qrProceed" style="display:none">scan other device's code</md-outlined-button>

          <p id="receiveInstructions" style="display:none"></p>
          <app-qrcode id="receiveCode" style="display:none"></app-qrcode>
          <slot name="receiveVideo"></slot>
          <md-outlined-button id="dummy" style="display:none">to make scrolling match</md-outlined-button>
        </div>
        <md-dialog id="hotspotCredentialsDialog">
          <div slot="headline">Tether another device to this one</div>
          <form class="column" slot="content" id="hotspotCredentialsForm" method="dialog">
            <md-outlined-text-field id="ssid" label="Your device/network name"></md-outlined-text-field>
            <md-outlined-text-field id="hotPass" label="Password"></md-outlined-text-field>
          </form>
          <div slot="actions">
            <md-text-button form="hotspotCredentialsForm" value="ok" type="submit">Save, and show QR code</md-text-button>
          </div>
        </md-dialog>
        <md-dialog id="hotspotQRDialog">
          <div slot="headline">Scan this with the other user's camera app</div>
          <form class="column" slot="content" id="hotspotQRForm" method="dialog">
            <app-qrcode id="hotspotCode"></app-qrcode>
          </form>
          <div slot="actions">
            <md-text-button form="hotspotQRForm" value="ok" type="submit">ok</md-text-button>
          </div>
        </md-dialog>
      </section>
    `;
  }
  get styles() {
    return `
      section { margin: var(--margin, 10px); }
      #dummy { visibility: hidden; }
      .column {
        display: flex;
        flex-direction: column;
        gap: var(--margin);
        align-items: center;
      }
   `;
  }
}
FairshareSync.register();

class FairshareBubble extends MDElement {
  // See https://www.subframe.com/tips/css-chat-examples
  // "3) CorporateSync Chat Interface" but with:
  //     Me (username) for myself, to left like others (see "7) Project Management Chat Interface)
  //     time on same line as username (to right, like "7")
  //     do not use this "typing" (as it does not say who. Want more like "10) Dynamic CSS Chat UI")
  get user() { return ''; }
  get message() { return '[[missing message]]'; }
  get time() { return '[[missing time]]'; }
  get isMe() { return this.user === App.user; }
  get isCommand() { return this.message.startsWith('/'); }
  get userEffect() {
    // TODO: isMe stuff ought to be set here rather than in template, so that we can switch user nicely.
    const user = App.userCollection[this.user];
    if (!user) return false;
    return this.shadow$('.message-sender').textContent = this.isMe ? `me (${user.title})` : user.title;
  }
  get template() {
    return `
<div class="message ${this.isMe ? 'outgoing' : 'incoming'} ${this.isCommand ? 'command' : ''}">
  <avatar-image class="message-avatar" tag="${this.user}"></avatar-image>
  <div class="message-content">
    <div class="message-meta">
      <span class="message-sender">...</span>
      <span class="message-time">${this.time}</span>
    </div>
    <div class="message-bubble">${this.message}</div>
  </div>
</div>`;
  }
  get styles() {
    return `
        .message {
            display: flex;
            gap: 10px;
        }
        .message.outgoing {
            align-self: flex-end;
            flex-direction: row-reverse;
        }
        .message-avatar {
            flex-shrink: 0;
        }
        .message-content {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .message-bubble {
            padding: 10px 15px;
            border-radius: 18px;
            font-size: 14px;
            max-width: 100%;
            word-wrap: break-word;
            position: relative;
        }
        .message.incoming .message-bubble {
            background-color: var(--md-sys-color-secondary-container);
            color: var(--md-sys-color-on-secondary-container);
            border-top-left-radius: 4px;
        }
        .message.outgoing .message-bubble {
            background-color: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-on-primary-container);
            border-top-right-radius: 4px
        }
        .message.command .message-bubble {
           border-radius: 4px;
           opacity: 0.7;
        }
        .message-sender {
            font-size: 12px;
            font-weight: 500;
            color: var(--md-sys-color-secondary);
        }
        .message-meta {
            display: flex;
            width: 100%;
            justify-content: space-between;
            align-items: center;
            gap: 5px;
            font-size: 11px;
            color: var(--md-sys-color-secondary);
            margin-left: auto;
            margin-top: 2px;
            margin-bottom: 2px;
        }
        .message.outgoing .message-sender,
        .message.outgoing .message-meta {
            color: var(--md-sys-color-outline-variant);
        }
    `;
  }
}
FairshareBubble.register();

class FairshareChatInput extends MDElement {
  get chatContainer() { return null; }
  get inputElement() {
    return this.shadow$('.input-box');
  }
  get sendElement() {
    return this.shadow$('md-icon-button');
  }
  maxHeight = 120; // pixels
  resizeTextArea() { // Make the text area be the right height for its content.
    // Reset height to auto to get the correct scrollHeight
    this.inputElement.style.height = 'auto';

    // Set the height to scrollHeight to fit all content
    const newHeight = Math.min(this.maxHeight, this.inputElement.scrollHeight); // Note box-sizing style.
    this.inputElement.style.height = newHeight + 'px';
  }
  receiveMessage(verified) {
    const {json, protectedHeader} = verified;
    const {text} = json;
    const {iss, iat, act} = protectedHeader;
    // Create new message element
    const messageElement = document.createElement('fairshare-bubble');
    messageElement.user = act;
    messageElement.time = new Date(iat).toLocaleString();
    messageElement.message = text;
    messageElement.verified = verified;

    // Add to chat container
    let children = this.chatContainer.children;
    let i = children.length;
    for (; i>0; i--) {
      let child = children[i-1];
      let {json, protectedHeader} = child.verified;
      //console.log(i, json.text, protectedHeader.iat, 'vs', text, iat);
      if (protectedHeader.iat < iat) {
	child.after(messageElement);
	break;
      }
    }
    //console.log('after loop, i=', i);
    if (i <= 0) {
      this.chatContainer.insertAdjacentElement('afterBegin', messageElement);
    }

    // Scroll to bottom
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight; // TODO: when/where should this be done?
  }
  async receiveMessages() {
    // We getVersions rather that iterating through the version antecedents, because only the former must be correct after merging.
    for (let hash of Object.values(await messages.getVersions(App.group)).slice(1)) {
      const message = await messages.retrieve({tag: App.FairShareTag, hash});
      this.receiveMessage(message);
    }
    return true;
  }
  async onupdate(verified) {
    const {protectedHeader} = verified;
    const {iss, iat, act} = protectedHeader;

    const isCurrentGroup = iss === App.group;
    if (isCurrentGroup) verified = await Collection.ensureDecrypted(verified);
    if (isCurrentGroup) this.receiveMessage(verified);
    if ((Notification.permission === "granted") &&
	App.userRecord?.getNotify(iss) &&
	(act !== App.user) &&
	(!isCurrentGroup || (App.screen !== 'History') || (document.visibilityState !== 'visible')) &&
	// Currently, we only show notifications from a group that the current user is a member of.
	// IWBNI if we showed notifications that any of this device's users are a member of.
	App.groupCollection.liveTags.includes(iss)) {
      verified = await Collection.ensureDecrypted(verified);
      const registration = await navigator.serviceWorker.ready;
      const title = `${App.getUserTitle(act)} in ${App.getGroupTitle(iss)}:`;
      const body = verified.json.text; // verified.json will have changed via decryption.
      const image = new URL('./images/fairshare-512.png', location.href).href;
      const timestamp = iat;
      const aud = App.user; // A member of the iss that is not act.
      const data = {iss, aud};
      const options = {body, image, timestamp, data};
      // Here notifications are local. They don't go through any service (which is nice for security), but they
      // only appear separately on each device that is running the app.
      // If you have, e.g., a Mac, iPhone, and iWatch, it would be nice if any one device that was running would
      // cause the message to show up everywhere. That could be done by going through Apple's service.
      registration.showNotification(title, options);
    // } else {
    //   console.log('notification is not sent', {permission: Notification.permission, notify: App.userRecord?.getNotify(iss),
    // 					       isCurrentUser: act === App.user, isCurrentGroup, isHistory: App.screen === 'History',
    // 					       isVisible: document.visibilityState === 'visible', act, iss});
    }
  }
  get groupEffect() {
    const group = App.group;
    if (!group) return false;
    this.chatContainer.innerHTML = '';
    return this.receiveMessages();
  }
  static send(message) {
    return messages.store(message, {tag: App.group, encryption: App.group});
  }
  async sendMessage() { // Send the text where it needs to go, and reset the input.
    const messageText = this.inputElement.value.trim();
    if (!messageText) return;
    this.constructor.send({text: messageText});
    // messages.onupdate will call receiveMessage().
    this.inputElement.value = '';   // Clear input
    this.resizeTextArea();
    this.sendElement.disabled = true;
  }
  handleFocus() {
    // Small delay to let keyboard appear
    setTimeout(() => {
      // Scroll the input into view
      this.inputElement.scrollIntoView({behavior: 'smooth'});

      // For iOS 15+, use a different approach to keep input visible
      if (window.innerHeight < window.outerHeight) {
        document.body.scrollTop = document.body.scrollHeight;
      }
    }, 300);
  }
  afterInitialize() {
    super.afterInitialize();
    this.constructor.instance = this;
    this.inputElement.addEventListener('input', () => {
      this.resizeTextArea();
      this.sendElement.disabled = this.inputElement.value.trim() === '';
    });

    this.inputElement.addEventListener('focus', () => this.handleFocus());
    this.sendElement.addEventListener('click', () => this.sendMessage());
    this.inputElement.addEventListener('keydown', (e) => {
      // Send on Enter (but allow Shift+Enter for new lines)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Initialize
    this.resizeTextArea();
    // Ensure we're scrolled to bottom initially
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    // Fix for iOS Safari to ensure input is visible when keyboard appears
    window.addEventListener('resize', () => {
      // This helps ensure the input stays in view when keyboard appears
      if (document.activeElement === this.inputElement) {
        setTimeout(() => {
          this.inputElement.parentElement.scrollIntoView({behavior: 'smooth'});
        }, 100);
      }
    });
  }
  get template() {
    return `
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
        <div class="input-container" id="inputContainer">
            <textarea
                class="input-box"
                placeholder="Type a message..."
                rows="1"
            ></textarea>
            <md-icon-button disabled><md-icon class="material-icons">send</md-icon></md-icon-button>
        </div>
       `;
  }
  get styles() {
    return `
        * { box-sizing: border-box; }
        md-icon-button {
          background-color: var(--md-sys-color-on-primary-container);
          border-radius: 50%;
        }
        md-icon { color: var(--md-sys-color-primary-container); }
        textarea { min-height: 40px; }
        .input-container {
            position: sticky;
            bottom: 0;
            left: 0;
            right: 0;
            background-color: #fff;
            padding: 12px;
            border-top: 1px solid #e0e0e0;
            display: flex;
            align-items: flex-end;
            z-index: 100;
        }
        .input-box::placeholder { color: var(--md-sys-color-outline-variant); font-style: italic; }
        .input-box {
            flex: 1;
            border: 1px solid #ddd;
            border-radius: 24px;
            color: var(--md-sys-color-on-primary-container);
            background-color: var(--md-sys-color-primary-container);
            padding: 12px 16px;
            max-height: ${this.maxHeight}px;
            overflow-y: auto;
            margin-right: 8px;
            outline: none;
            resize: none;
            line-height: 1.4;
            /* Hide scrollbar for Chrome, Safari and Opera */
            scrollbar-width: none; /* Firefox */
            -ms-overflow-style: none; /* IE and Edge */
        }
        /* Hide scrollbar for Chrome, Safari and Opera */
        .input-box::-webkit-scrollbar {
            display: none;
        }
      `;
  }
}
FairshareChatInput.register();

class FairshareHistory extends MDElement {
  afterInitialize() {
    super.afterInitialize();
    const chatContainer = this.shadow$('.messages');
    this.shadow$('fairshare-chat-input').chatContainer = chatContainer;
  }
  get template() {
    return `
      <section>
        <div class="messages"></div>
        <fairshare-chat-input></fairshare-chat-input>
      </section>
    `;
  }
  get styles() {
    return `
      section {
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      .messages {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
        padding-bottom: 80px;
      }
    `;
  }
}
FairshareHistory.register();

class FairsharePay extends MDElement {
  get transactionElement1() { // There will be more with exchanges.
    return this.shadow$('fairshare-transaction');
  }
  get payElement() {
    return this.shadow$('#pay');
  }
  get payeeElement() {
    return this.shadow$('fairshare-group-members-menu-button');
  }
  get payeeEffect() {
    if (this.payeeElement.choice) return App.resetUrl({payee: this.payeeElement.choice});
    if (!App.payee || !App.groupRecord) return null;
    App.alert(`When exchanges are implemented, you will be able to pay across groups. But for now, you cannot pay ${App.payee} because they are not a member of ${App.group}.`).then(() => App.resetUrl({payee: ''}));
    return null;
  }
  get validationEffect() {
    this.payElement.toggleAttribute('disabled', !this.transactionElement1.valid);
    return true;
  }
  afterInitialize() {
    super.afterInitialize();
    this.payeeElement.choice = App.payee;
    this.payElement.addEventListener('click', async event => {
      const amount = App.amount;
      const payee = App.payee;
      const button = event.target;
      button.toggleAttribute('disabled', true);
      this.transactionElement1.memo = this.shadow$('[label=memo]').value.trim();
      await this.transactionElement1.onaction();
      this.payeeElement.choice = '';
      App.resetUrl({payee: '', amount: ''});
      App.alert(`Paid ${amount} ${App.groupRecord.title} to ${App.userCollection[payee]?.title || payee}.`);
      button.toggleAttribute('disabled', false);
    });
  }
  get template() {
    return `
      <section>
        <div class="row">
          <fairshare-amount></fairshare-amount>
          <fairshare-groups-menu-button></fairshare-groups-menu-button>
          to
          <fairshare-group-members-menu-button></fairshare-group-members-menu-button>
        </div>
        <md-outlined-text-field
          type="textarea"
          label="memo"
          rows="1">
        </md-outlined-text-field>
        <hr>
        <fairshare-transaction></fairshare-transaction>
        <md-filled-button id="pay" disabled>Pay</md-filled-button>
      </section>
    `;
  }
  get styles() {
    return `
      .row {
        display: flex;
        gap: var(--margin);
        align-items: center;
      }
      md-outlined-text-field {
        width: 100%;
        margin-top: 6px;
      }
      section { margin: var(--margin); }
    `;
  }
}
FairsharePay.register();

class FairshareTransaction extends MDElement {
  get groupRecord() {
    return (App.groupRecord?.isLiveRecord && App.groupRecord) || new Group();
  }
  get amount() {
    return App.amount;
  }
  get payee() {
    return App.payee;
  }
  get fee() {
    return this.groupRecord.roundUpToNearest(this.groupRecord.rate * this.amount);
  }
  get cost() {
    if (App.user == this.payee) return this.fee;
    return this.groupRecord.roundUpToNearest(this.amount + this.fee);
  }
  get balanceBefore() {
    return this.groupRecord.getBalance(App.user) || 0;
  }
  get balanceAfter() {
    return this.groupRecord.roundDownToNearest(this.balanceBefore - this.cost);
  }
  get valid() {
    return this.payee && this.amount && this.balanceAfter > 0;
  }
  get paymentEffect() {
    this.shadow$('#balanceBefore').textContent = this.balanceBefore;
    this.shadow$('#cost').textContent = this.cost;
    this.shadow$('#group').textContent = this.groupRecord.title;
    this.shadow$('#rate').textContent = this.groupRecord.rate;
    this.shadow$('#balanceAfter').textContent = this.balanceAfter;
    return true;
  }
  get template() {
    return `
       your balance: <span id="balanceBefore"></span><br/>
       cost with fee: -<span id="cost"></span> (<span id="group"></span> rate: <span id="rate"></span>)
       <hr>
       balance after: <span id="balanceAfter"></span>
    `;
  }
  async onaction() {
      this.groupRecord.adjustBalance(App.user, -this.cost);
      if (App.user !== this.payee) this.groupRecord.adjustBalance(this.payee, this.amount);
      await App.setGroup(App.group, this.groupRecord);
    this.balanceBefore = undefined; // TODO: replace getBalance with a proper rule so that this isn't necessary.
    FairshareChatInput.send({text: `/pay @${App.userCollection[this.payee]?.title || this.payee} ${this.amount} ${this.groupRecord.title}${this.memo ? ': ' : ''}${this.memo}`});
  }
}
FairshareTransaction.register();

class FairshareInvest extends MDElement {
  get template() {
    return `<p><i>Investing in a groups is not implemented yet, but see <a href="https://howard-stearns.github.io/FairShare-initial-poc/app.html?user=alice&groupFilter=&group=apples&payee=carol&amount=10&investment=-50&currency=fairshare#invest" target="fairshare-poc">proof of concept</a> in another tab.</i></p>`;
  }
}
FairshareInvest.register();


class FairshareCreateUser extends CreateUser {
  activate() { // Creating a new user should always put them in the FairShare group.
    super.activate();
    App.resetUrl({group: App.FairShareTag});
  }
  async onaction(form) {
    await super.onaction(form);
    await FairshareGroups.adopt(App.FairShareTag);
  }
}
FairshareCreateUser.register();

class FairshareCreateGroup extends MDElement {
  get template() {
    return `<edit-group><slot></slot></edit-group>`;
  }
  async onaction(form) {
    App.resetUrl({payee: ''}); // Any existing payee cannot possibly be a member.
    const component = this.findParentComponent(form),
	  tag = await component?.tag;
    await FairshareGroups.adopt(tag);
  }
}
FairshareCreateGroup.register();

async function showRaw(collection, tag) {
  App.alert(`<pre>${JSON.stringify(Collection.maybeInflate(await collection.get(tag)), null, 2)}</pre>`);
}
async function showSignature(collection, tag) {
  App.alert(`<pre>${JSON.stringify(await collection.retrieve({tag: tag, decrypt: false}),
                                  (key, value) => (['payload'].includes(key)) ? `<${value.length} bytes>` : value,
                                  2)}</pre>`);
}
async function showDecrypted(collection, tag) {
  App.alert(`<pre>${JSON.stringify(await collection.retrieve({tag: tag}),
                                  (key, value) => (['payload', 'plaintext'].includes(key)) ? `<${value.length} bytes>` : value,
                                  2)}</pre>`);
}

class FairshareUserProfile extends UserProfile {
  get template() {
    return `
       <edit-user>
        <p>You can change your user name and picture.</i></p>
        <p slot="securityInstructions">You can leave the security answer blank to leave it unchanged, or you can change the question and answer. (We cannot show you the current answer because we don't know it!)</p>
        <div slot="extra">
         <hr/>
         <md-outlined-button id="raw">show currently stored</md-outlined-button>
         <md-outlined-button id="signature">show validated</md-outlined-button>
         <md-outlined-button id="decrypted">show decrypted</md-outlined-button>
       <div>
       </edit-user>`;
  }
  afterInitialize() {
    super.afterInitialize();
    this.shadow$('#raw').onclick = async () => showRaw(usersPrivate, App.user);
    this.shadow$('#signature').onclick = async () => showSignature(usersPrivate, App.user);
    this.shadow$('#decrypted').onclick = async () => showDecrypted(usersPrivate, App.user);
  }
}
FairshareUserProfile.register();

class FairshareGroupProfile extends MDElement {
  get template() {
    return `
       <edit-group>
         <p>You can change the group name, picture, tax rate, and daily stipend. <i>(These changes take effect when you click "Go". In future versions, an average of each vote will be used)</i></p>
       <div slot="extra">
         <hr/>
         <md-outlined-button id="raw">show currently stored</md-outlined-button>
         <md-outlined-button id="signature">show validated</md-outlined-button>
         <md-outlined-button id="decrypted">show decrypted</md-outlined-button>
       <div>
       </edit-group>`;
  }
  afterInitialize() {
    super.afterInitialize();
    this.shadow$('#raw').onclick = async () => showRaw(groupsPrivate, App.group);
    this.shadow$('#signature').onclick = async () => showSignature(groupsPrivate, App.group);
    this.shadow$('#decrypted').onclick = async () => showDecrypted(groupsPrivate, App.group);
  }
  async onaction(form) {
    await App.groupCollection.updateLiveRecord(this.findParentComponent(form).tag);
    App.resetUrl({screen: App.defaultScreenTitle});
  }
  get editElement() {
    return this.content.firstElementChild;
  }
  get groupEffect() { // Update edit-group with our data.
    const edit = this.editElement;
    const record = App.groupRecord;
    const title = record?.title || 'loading';
    const picture = record?.picture || '';
    const rate = record?.rate || 0.01;
    const stipend = record?.stipend || 1;
    if (!App.groupRecord) return false;

    edit.picture = picture;

    edit.allowedTitle = title;
    edit.title = undefined;
    edit.owner = record?.owner;
    // This next casues a warning if the screen is not actually being shown:
    // Invalid keyframe value for property transform: translateX(0px) translateY(NaNpx) scale(NaN)
    edit.usernameElement.value = title;
    edit.notifyElement.checked = App.userRecord?.getNotify?.(App.group);
    // Disable editing of the FairShare title, as App.FairShareTag depends on it being constant.
    edit.usernameElement.toggleAttribute('disabled', (edit.owner === App.FairShareTag));

    edit.shadow$('#currentRate').textContent = edit.rateElement.value = rate;
    edit.shadow$('#currentStipend').textContent = edit.stipendElement.value = stipend;

    return true;
  }
}
FairshareGroupProfile.register();


export class EditGroup extends MDElement {
  // Must be at a lower level than a screen, because title means different things here and there.
  get title() {
    return this.usernameElement.value || '';
  }
  get picture() {
    return '';
  }
  get owner() { // Overridden by FairshareGroupProfile.
    return '';
  }
  get tag() {
    return this.owner;
  }
  get exists() {
    return App.findGroup({title: this.title}) || null;
  }
  setUsernameValidity(message) {
    this.usernameElement.setCustomValidity(message);
    this.usernameElement.reportValidity(); // Alas, it doesn't display immediately.
    // Not sure if we want to disable the submitElement. 'change' only fires on a change or on submit, so people might not realize
    // how to get the "Group already exists" dialog.
    return !message;
  }
  get expectUnique() {
    return true;
  }
  async checkUsernameAvailable() { // Returns true if available. Forces update of username.
    this.title = undefined;
    if (!this.title) return this.setUsernameValidity('');
    if (this.allowedTitle === this.title) return this.setUsernameValidity('');
    if (!await this.exists) return this.setUsernameValidity('');
    await this.setUsernameValidity("Already exists");
    console.warn(`${this.title} already exists.`);
    return false;
  }
  async onaction(target) {
    const data = Object.fromEntries(new FormData(target)); // Must be now, before await.
    const element = this.notifyElement;
    const checked = element.checked;
    if (!await this.checkUsernameAvailable()) return null;
    if (!data.picture.size) data.picture = this.picture;
    else data.picture = await AvatarImage.fileData(data.picture);
    // Credentials.owner may already be set (editing), but we need it set now for setGroup.
    this.owner ||= await Credentials.create(App.user);
    Credentials.owner = data.owner = this.owner;
    const tag = this.tag;
    await App.setGroup(tag, data); // Set the data, whether new or not.
    await this.parentComponent.onaction?.(target);
    // After parentComponent.onaction, we are certain to have tag in userRecord.groups
    // Notify preference is per group, but set in the the private user data.
    await App.userCollection.updateLiveRecord(App.user); // Is this necessary? Why?
    const index = App.userRecord.groups.indexOf(tag);
    const notify = App.userRecord.notify;
    notify[index] = checked;
    await App.setUser(App.user, {notify});
    await App.userCollection.updateLiveRecord(App.user);
    return null;
  }
  afterInitialize() {
    super.afterInitialize();

    this.shadow$('.avatarImage').model = this;

    this.usernameElement.addEventListener('input', () => {
      this.checkUsernameAvailable();
    });
    this.usernameElement.addEventListener('change', async () => { // When user commits name, give popup if not available.
      if (await this.checkUsernameAvailable()) return;
      const group = this.title;
      if (App.groupCollection.liveTags.includes(group)) {
	const response = await App.confirm(`Would you like to switch to this group?`,
					   "You are already a member of this group.");
	if (response === 'ok') App.resetUrl({screen: App.defaultScreenTitle, group});
      } else {
	const response = await App.confirm(`Would you like to join ${group}?`,
					   "Group already exists");
	if (response === 'ok') App.resetUrl({screen: "Join existing group"});
      }
    });
    this.shadow$('input[type="file"]').addEventListener('change', async event => {
      this.picture = event.target.files[0];
    });
    this.shadow$('[slot="content"]').addEventListener('submit', async event => {
      const button = event.target;
      button.toggleAttribute('disabled', true);
      await this.onaction(event.target);
      button.toggleAttribute('disabled', false);
    });
    this.shadow$('[name="pictureClear"]').addEventListener('click',  event => {
      event.stopPropagation();
      event.preventDefault();
      this.shadow$('[type="file"]').value = null;
      this.picture = '';
    });
    this.shadow$('[name="pictureDriver"]').addEventListener('click',  event => {
      event.stopPropagation();
      event.preventDefault();
      this.shadow$('[type="file"]').click();
    });
    this.notifyElement.addEventListener('click', event => {
      const checkbox = event.target;
      setTimeout(async () => { // Value isn't set yet
	if (!checkbox.checked) return;
	const permission = await Notification.requestPermission();
	if (permission === 'granted') return;
	checkbox.checked = false;
      });
    });
  }
  get usernameElement() { // A misnomer, carried over from EditUser.
    return this.shadow$('[name="title"]');
  }
  get rateElement() {
    return this.shadow$('[name="rate"]');
  }
  get stipendElement() {
    return this.shadow$('[name="stipend"]');
  }
  get notifyElement() {
    return this.shadow$('#notify');
  }
  get submitElement() {
    return this.shadow$('[type="submit"]');
  }
  get formId() {
    return this.parentComponent.title;
  }
  get template() {
    // ids are set in a failed effort to work around https://github.com/material-components/material-web/issues/5344, which MD Web says is a chrome bug.
    // Found 3 elements with non-unique id #button
    return `
	  <section>
	    <slot name="headline" slot="headline"></slot>
	    <form method="dialog" slot="content" id="${this.formId}">

              <slot></slot>
              <md-outlined-text-field required
                   autocapitalize="words"
                   minlength="1" maxlength="60"
                   label="group name"
                   name="title"
                   id="${this.formId}-groupname">
              </md-outlined-text-field>

              <div class="avatar">
		<div class="column">
		  Your Image
		  <group-image class="avatarImage" size="80"></group-image>
		</div>
		<div class="column">
		  <md-outlined-button name="pictureDriver" id="${this.formId}-pictureDriver">Use photo</md-outlined-button>
		  <md-outlined-button name="pictureClear" id="${this.formId}-pictureClearr">Clear photo</md-outlined-button>
		  <input type="file" accept=".jpg,.jpeg,.png,.webp" name="picture" id="${this.formId}-picture"></input>
		</div>
              </div>

              <div class="row">
		<md-outlined-text-field required
		     type="number" min="0" step="0.01"
		     label="tax rate on each transaction"
		     name="rate"
		     value="0.01"
		     id="${this.formId}-rate">
		</md-outlined-text-field>
                <div class="current">(currently <span id="currentRate">x</span>)</div>
              </div>
              <div class="row">
		<md-outlined-text-field required
		     type="number" min="0" step="0.01"
		     label="daily stipend for each member"
		     name="stipend"
		     value="1"
		     id="${this.formId}-stipend">
		</md-outlined-text-field>
                <div class="current">(currently <span id="currentStipend">x</span>)</div>
              </div>
              <div class="row">
                <label><md-checkbox id="notify"></md-checkbox> Notify me about activity in this group</label>
              </div>
            </form>
	    <div slot="actions">
              <md-filled-button type="submit" form="${this.formId}" id="${this.formId}-submit"> <!-- cannot be a fab -->
                 Go
                 <material-icon slot="icon">login</material-icon>
              </md-filled-button>
	    </div>
            <slot name="extra"></slot>
	  </section>
     `;
  }
  get styles() {
    return `
      section { margin: var(--margin, 10px); }
      [type="file"] { display: none; }
      form, .column {
        display: flex;
        flex-direction: column;
        // justify-content: space-between;
        gap: 10px;
        margin: 10px;
      }
      .avatar, [slot="actions"], .row {
         display: flex;
         flex-direction: row;
         justify-content: center;
         gap: 10px;
         margin: 10px;
      }
      .row { align-items: baseline; }
      .avatar, .avatar > div { align-items: center; }
      [slot="actions"] { margin-top: 20px; }
      ${this.expectUnique ? '.current {display:none;}' : ''}
    `;
  }
}
EditGroup.register();


try {
  const registration = await navigator.serviceWorker.register("/fairshare/sw.js", {
    //scope: "/",
  });
  if (registration.installing) {
    console.log("Service worker installing");
  } else if (registration.waiting) {
    console.log("Service worker installed");
  } else if (registration.active) {
    console.log("Service worker active");
  }
} catch (error) {
  console.error(`Registration failed with ${error}`);
}
window.bootstrap = async function bootstrap() { // Used to get the system started from nothing.
  Credentials.author = await Credentials.createAuthor('-'); // Create invite.
  Credentials.owner = await Credentials.create(Credentials.author); // Create Fairshare owner team, with that member.
  let fairshare = {title: "FairShare", owner: Credentials.owner}; // When we create new user, it will adopt the group.
  await groupsPublic.store(fairshare, {tag: Credentials.owner}); // Store FairShare, with that author & owner.
  location.href = App.urlWith({invitation: Credentials.author, screen: "Create new account", user:'', group:''}).href;
}
