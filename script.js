import { App, MDElement,  BasicApp, AppShare, CreateUser, LiveCollection, MenuButton, LiveList, AvatarImage, AuthorizeUser, AppFirstuse } from '@kilroy-code/ui-components';
import { Rule } from '@kilroy-code/rules';
import { Credentials, MutableCollection, Collection } from '@kilroy-code/flexstore';
import QrScanner from './qr-scanner.min.js'; 

const { localStorage, URL, crypto, TextEncoder, FormData, RTCPeerConnection } = window;

// Cleanup todo:
// - Set App.mumble vs App.resetUrl. Which to use? Be consistent.

class User { // A single user, which must be one that the human has authorized on this machine.
  constructor(properties) { Object.assign(this, properties); }
  isLiveRecord = true;
  get title() { return 'unknown'; }
  get picture() { return ''; }
  get groups() { return []; }
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
  balances = {};
  static millisecondsPerDay = 1e3 * 60 * 60 * 24;
  // For now, these next two are deliberately adding the user if not already present.
  getBalance(user) { // Updates for daily stipend, and returns the result.
    const data = this.balances[user] || {balance: this.stipend * 10}; // Just for now, start new users with some money.
    if (!data) return 0;
    const now = Date.now();
    let {balance, lastStipend = now} = data;
    const daysSince = Math.floor((now - lastStipend) / Group.millisecondsPerDay);
    balance += this.stipend * daysSince;
    balance = this.roundDownToNearest(balance);
    lastStipend = now;
    this.balances[user] = {balance, lastStipend};
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
  This causes the collection to start asking the server for a POJO record of the import public data (e.g., title, picture) for each known tag using getUserData/getGroupData.
  These POJOs are kept in collection[tag].

  When we want to instead get a rule-based live model (a User or Group), the LiveCollection pulls this in with getUserModel/getGroupModel.
  Any changes pushed to us should effect the collection[tag], and the app takes it from there.
  App.setGroup/setUser are called to persist whole updated records, using setUserData/setGroupData, always on a tag for which we have a live model.
  The set of such live tags is updated with LiveCollection.updateLiveTags:
    The list of Users live tags are persisted in localStorage, and added to whenever we create or authorize a new user.
    The list of Group live tags is enumerated for each user, and added to whenver we create or join a new group.

  As a first step in using Flexstore, there will be "social.fairshare.users" and "social.fairshare.groups" collections.
  Getting a live model will consist of adding an event handler for the specific tag.
  That will mean that anyone connected will get an update about any changes to any group or user, which will usually be ignored.
  A minor(?) next step is to pull pictures out into a media collection.
  Next, the user and group collections will just be the directories with the public info about public groups, and the real data will be in a
  separate collection specific to the group:
  - Items will be encrypted for the group audience only.
  - Updates will only be seen (with encrypted conent and open signatures) for those connected to the specific group/collection being updated.
  - Groups may decide to not list in the directory, and/or to not synchronize their data to a public relay.
*/
const services = [new URL('/flexstore', location).href];
const users = new MutableCollection({name: 'social.fairshare.users'});
const groups = new MutableCollection({name: 'social.fairshare.groups'});
Object.assign(window, {Credentials, MutableCollection, Collection, groups, users, Group, User});
function addUnknown(collectionName) {
  return event => {
    const tag = event.detail.tag;
    const collection = App[collectionName];
    const known = collection.knownTags;
    if (known.includes(tag)) return;
    collection.updateKnownTags([...known, tag]);
  };
}
users.onupdate = addUnknown('userCollection');
groups.onupdate = addUnknown('groupCollection');

//Object.values(Credentials.collections).forEach(c => c.debug = true); users.debug = groups.debug = true;
Credentials.synchronize(...services).then(() => { // Do not block loading for this. There is code that needs App to be instantiated/set.
  users.synchronize(...services);
  groups.synchronize(...services);
});

function getUserList() { return users.list(); }
function getGroupList() { return groups.list(); }
async function getUserData(tag)  { return (await users.retrieve({tag}))?.json || ''; } // Not undefined.
async function getGroupData(tag) { return (await groups.retrieve({tag}))?.json || ''; }
// Users are only ever written by the owner, even if a different persona is current. The tag is the user's individual key tag.
function setUserData(tag, data)  { return users.store(data, {tag, author: tag, owner: ''}); }
// Groups are written by their member tag on behalf of the whole-group owner (which they are a member of).
function setGroupData(tag, data) { return groups.store(data, {tag}); }
async function getUserModel(tag) {
  // TODO: listen for updates
  const data = await getUserData(tag);
  return new User(data);
}
async function getGroupModel(tag) {
  // TODO: listen for updates
  const data = await getGroupData(tag);
  return new Group(data);
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
    this.updateLiveFromLocal('userCollection');
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
    groups.find({title: 'FairShare'}).then(tag => this.FairShareTag = tag); // Once we're in production, we can hardcode this.
  }
  get userCollection() { // The FairshareApp constructor gets the liveTags locally, before anything else.
    const users = new LiveCollection({getRecord: getUserData, getLiveRecord: getUserModel});
    users['0'] = {title: 'New user'}; // Hack
    return users;
  }
  get liveUsersEffect() { // If this.userCollection.liveTags changes, write the list to localStorage for future visits.
    return this.setLocalLive('userCollection');
  }
  getUserTitle(key = App.user) { // Name of the specified user.
    return this.userCollection[key]?.title || key;
  }
  get groupCollection() { // As with userCollection, it is stable as a collection, but with liveTags changing.
    return new LiveCollection({getRecord: getGroupData, getLiveRecord: getGroupModel});
  }
  get group() {
    let param = this.getParameter('group');
    return param || this.FairShareTag;
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
  get groupRecord() {
    let group = this.group;
    const groups = this.userRecord?.groups;
    if (!group || !groups) return null; // If either of the above changes, we'll recompute.
    if (!groups.includes(group)) { // If we're not in the requested group...
      const next = groups[0];
      if (!next) return null; // New user.
      console.info(`${this.userRecord.title} is not a member of ${this.getGroupTitle(group)}. Trying to adopt.`);
      Credentials.author = this.user;
      Credentials.owner = group;
      FairshareGroups.adopt(group).catch(error => {
	console.error(error);
	this.resetUrl({group: next});
      });
      return null;
    }
    this.groupCollection.updateLiveTags(groups); // Ensures that there are named rules for each group.
    return this.groupCollection[group];
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
  setLocalLive(collectionName) {
    const currentData = this[collectionName].liveTags;
    return this.setLocal(collectionName, currentData);
  }
  getLocalLive(collectionName) {
    return this.getLocal(collectionName, []);
  }
  updateLiveFromLocal(collectionName) {
    let stored = this.getLocalLive(collectionName);
    const collection = this[collectionName];
    return collection.updateLiveTags(stored);
  }
  async createUserTag(editUserComponent) { // For (AppFirstuse >) CreateUser > EditUser
    const prompt = editUserComponent.questionElement.value;
    Credentials.setAnswer(prompt, editUserComponent.answerElement.value);

    const invitation = App.url.searchParams.get('invitation');
    if (invitation) {
      return await Credentials.claimInvitation(invitation, prompt);
    }
    const tag = await Credentials.createAuthor(prompt);
    await FairshareGroups.addToOwner(tag);
    return tag;
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
  get setUser() { // TODO: change these two names (one in ui-components), to something implying that data will be merged and saved. (Do they really have to be rules?)
    return (tag, newData) => {
      return setUserData(tag, this.mergeData(this.userCollection[tag], newData));
    };
  }
  get setGroup() {
    return (tag, newData) => {
      const oldData = this.groupCollection[tag];
      const merged = this.mergeData(oldData, newData);
      delete merged.members; // for now, let it be generated by rule
      return setGroupData(tag, merged);
    };
  }

  get userEffect() {
    return Credentials.author = this.user || '';
  }
  get groupRecordEffect() {
    return Credentials.owner = this.groupRecord?.owner || '';
  }
  get groupEffect() {
    return this.resetUrl({group: this.group});
  }
  get amountEffect() {
    return this.resetUrl({amount: this.amount});
  }
  get payeeEffect() {
    return this.resetUrl({payee: this.payee});
  }
  select(key) {
    if (key === 'Group actions...') return this.$('#groupMenuButton').button.click();
    if (key === 'User actions...') return this.$('#user').button.click();
    super.select(key);
    return null;
  }
}
FairshareApp.register();

class GroupImage extends AvatarImage {
  get model() {
    return App.groupRecord || null;
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
  get choiceEffect() {
    return this.button.textContent = this.collection[this.choice]?.title || "Select a group";
  }
  get tags() {
    const collection = this.collection;
    if (!collection) return [];
    const live = new Set(collection?.liveTags);
    return collection.knownTags.filter(tag => !live.has(tag));
  }
  afterInitialize() {
    super.afterInitialize();
    this.button.textContent = "Select a group";
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
    Credentials.setAnswer(prompt, answer);
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
    const groups = [...App.userRecord?.groups || [], groupTag];

    // Update persistent and live group data (which the user doesn't have yet):
    const groupRecord = await App.groupCollection.getLiveRecord(groupTag);
    App.groupCollection.addRecordRule(groupTag, groupRecord); 
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
  afterInitialize() {
    super.afterInitialize();
    this.joinElement.addEventListener('click', async event => {
      const button = event.target;
      button.toggleAttribute('disabled', true);
      const menu = this.otherGroupsElement;
      await FairshareGroups.join(menu.choice);
      menu.choice = '';
      button.toggleAttribute('disabled', false);
      return true;
    });
  }
  get template() {
    return `
      <section>
        <p>You can join <fairshare-all-other-groups-menu-button></fairshare-all-other-groups-menu-button>.</p>
        <p><i>Currently, you will be added immediately. Later, you will have to be voted in.</i></p>
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
  async generateUrl(user, group) {
    if (!user) return '';
    let invitation = '';
    if (user === '0') {
      invitation = await Credentials.createAuthor('-');
      user = group = '';
    }
    await FairshareGroups.addToOwner(invitation || user, group || App.FairShareTag);
    const url = App.urlWith({user, invitation, group, payee: '', amount: '', screen: ''});
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
  get buttonChoicesEffect() {
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
  }
}
FairshareShare.register();

class FairshareFirstuse extends AppFirstuse {
  activate() {
    super.activate();
    if (!App.getParameter('invitation')) App.resetUrl({screen: 'Add existing account'});
  }
}
FairshareFirstuse.register();

class FairsharePayme extends AppShare {
  get url() {
    return App.urlWith({user: '', payee: App.user, amount: App.amount || '', screen: 'Pay'});
  }
  get description() {
    return App.amount ?
      `Please pay ${App.amount} ${App.group} to ${App.user}.` :
      `Please pay ${App.group} to ${App.user}.`;
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

class WebRTC {
  constructor({label = '', rtcConfiguration = {}} = {}) {
    this.label = label;
    this.configuration = rtcConfiguration;
    this.resetPeer();
  }
  peerVersion = 0;
  resetPeer() {
    const peer = this.peer = new RTCPeerConnection(this.rtcConfiguration);
    peer.versionId = this.peerVersion++;
    this.log('new peer', peer.versionId);
    peer.addEventListener('negotiationneeded', event => this.negotiationneeded(event));
    // The spec says that a null candidate should not be sent, but that an empty string candidate should.
    // But Safari gets errors either way.
    peer.addEventListener('icecandidate',
			  event => {
			    if (!event.candidate || !event.candidate.candidate) this.endIce?.();
			    // event.candidate && event.candidate.candidate &&
			    else this.signal('icecandidate', event.candidate);
			  });
    // I don't think anyone actually signals this. Instead, they reject from addIceCandidate, which we handle the same.
    peer.addEventListener('icecandidateerror', error => this.icecandidateerror(error));
    peer.addEventListener('connectionstatechange', event => this.connectionStateChange(this.peer.connectionState));
  }
  createDataChannel(label = "data", channelOptions = {}) { // Promise resolves when the channel is open (implying negotiation has happened).
    //this.log('createDataChannel');
    return new Promise(resolve => {
      const channel = this.peer.createDataChannel(label, channelOptions);
      channel.onopen = _ => resolve(channel);
    });
  }
  close() {
    this.peer.close(); // Will trigger a state change on the other side, but not this side...
    this.resetPeer();  // ...so reset this side now.
  }
  connectionStateChange(state) {
    this.log('state change:', state);
    if (state === 'disconnected') this.resetPeer(); // Other behavior are reasonable, tolo.
  }
  negotiationneeded() { // Something has changed locally (new stream, or network change), such that we have to start negotiation.
    
    //this.log('negotiationnneded');
    this.peer.createOffer()
      .then(offer => {
        this.peer.setLocalDescription(offer); // promise does not resolve to offer
	return offer;
      })
      .then(offer => this.signal('offer', offer))
      .catch(error => this.negotiationneededError(error));
  }
  offer(offer) { // Handler for receiving an offer from the other user (who started the signaling process).
    // Note that during signaling, we will receive negotiationneeded/answer, or offer, but not both, depending
    // on whether we were the one that started the signaling process.
    //this.log('received offer', offer);
    this.peer.setRemoteDescription(offer)
      .then(_ => this.peer.createAnswer())
      .then(answer => this.peer.setLocalDescription(answer)) // promise does not resolve to answer
      .then(_ => this.signal('answer', this.peer.localDescription));
  }
  answer(answer) { // Handler for finishing the signaling process that we started.
    //this.log('received answer', answer);
    this.peer.setRemoteDescription(answer);
  }
  icecandidate(iceCandidate) { // Handler for a new candidate received from the other end through signaling.
    //this.log('received iceCandidate', iceCandidate);
    this.peer.addIceCandidate(iceCandidate).catch(error => this.icecandidateError(error));
  }
  log(...rest) {
    console.log(this.label, ...rest);
  }
  logError(label, eventOrException) {
    const data = [this.label, ...this.constructor.gatherErrorData(label, eventOrException)];
    console.error.apply(console, data);
    return data;
  }
  static gatherErrorData(label, eventOrException) {
    return [
      label + " error:",
      eventOrException.code || eventOrException.errorCode || eventOrException.status || "", // First is deprecated, but still useful.
      eventOrException.url || eventOrException.name || '',
      eventOrException.message || eventOrException.errorText || eventOrException.statusText || eventOrException
    ];
  }
  icecandidateError(eventOrException) { // For errors on this peer during gathering.
    // Can be overridden or extended by applications.

    // STUN errors are in the range 300-699. See RFC 5389, section 15.6
    // for a list of codes. TURN adds a few more error codes; see
    // RFC 5766, section 15 for details.
    // Server could not be reached are in the range 700-799.
    const code = eventOrException.code || eventOrException.errorCode || eventOrException.status;
    // Chrome gives 701 errors for some turn servers that it does not give for other turn servers.
    // This isn't good, but it's way too noisy to slog through such errors, and I don't know how to fix our turn configuration.
    if (code === 701) return;
    this.logError('ice', eventOrException);
  }
  signal(type, message) {
    this.log('sending', type, type.length, JSON.stringify(message).length);
  }
}
class LocalWebRTC extends WebRTC {
  // 0. Something trigger negotiation on peer1 (such as creating a peer1.createDataChannel()). 
  // 1. peer1.signals resolves with <signal1> POJO to be conveyed to peer2.
  // 2. Set peer2.signals = <signal1>.
  // 3. peer2.signals resolves  with <signal2> POJO to be conveyed to peer1.
  // 4. Set peer1.signals = <signal2>.
  // 5. Data flows, but each side whould grab a new signals promise and be prepared to act if it resolves.
  get signals() { // Returns a promise that resolve to the signal messaging when ice candidate gathering is complete.
    return this._signalPromise ||= new Promise(resolve => this._signalReady = resolve);
  }
  set signals(data) { // Set with the signals received from the other end.
    data.forEach(([type, message]) => this[type](message));
  }
  async endIce() {
    if (!this._signalPromise) {
      this.logError('ice', "End of ICE without anything waiting on signals.");
      return;
    }
    this._signalReady(this.sending);
    delete this._signalPromise;
    this.sending = [];
  }
  sending = [];
  signal(type, message) {
    super.signal(type, message);
    this.sending.push([type, message]);
  }
}

const LOCAL_TEST = false; // True if looping back on same machine by reading our own qr codes as a self2self test.
class FairshareSync extends MDElement {
  get sendCode() { return this.shadow$('#sendCode'); }
  get receiveCode() { return this.shadow$('#receiveCode');}   
  get sendVideo() { return this.shadow$('slot[name="sendVideo"]').assignedElements()[0]; }
  get receiveVideo() { return this.shadow$('slot[name="receiveVideo"]').assignedElements()[0]; }
  get send() { return this.shadow$('#send'); }
  get receive() { return  this.shadow$('#receive'); }
  get instructions() { return this.shadow$('#instructions'); }  
  get sendInstructions() { return this.shadow$('#sendInstructions'); }
  get receiveInstructions() { return this.shadow$('#receiveInstructions'); }  
  get sender() { return new LocalWebRTC({label: 'sender'}); }
  get receiver() { return new LocalWebRTC({label: 'receiver'}); }
  hide(element) { element.style.display = 'none'; }
  show(element) {
    element.style.display = '';
    element.toggleAttribute('disabled', false);
  }
  updateText(element, text) {
    this.show(element);
    element.textContent = text;
  }
  async scan(view, onDecodeError = _ => _, localTestQrCode = null) { // Scan the code at view, unless a local app-qrcode is supplied to read directly.
    // Returns a promise for the JSON-parsed scanned string
    if (localTestQrCode) {
      const generator = await localTestQrCode.generator;
      const blob = await generator.getRawData('svg');
      return JSON.parse(await QrScanner.scanImage(blob));
    }
    return new Promise(resolve => {
      let gotError = false;
      const scanner = new QrScanner(view,
				    result => {
				      scanner.stop();
				      scanner.destroy();
				      resolve(JSON.parse(result.data));
				    }, {
				      onDecodeError,
				      highlightScanRegion: true,
				      highlightCodeOutline: true,
				    });
      scanner.start();
    });
  }
  testMessageSize = 16 * 1024; // See https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels#concerns_with_large_messages
  nTestMessages = (10 * 1024 * 1024) / (16 * 1024); // 10 MB
  makeTestMessage(length = this.testMessageSize) {
    return Array.from({length}, (_, index) => index & 1).join('');
  }
  generateTestDataHandler(element, onFinished = null) {
    let nReceived = 0;
    let initialMessage;
    let totalBytes = 0;
    const start = Date.now();
    return event => {
      totalBytes += event.data.length;
      nReceived += 1;
      if (!initialMessage) {
	initialMessage = event.data;
	this.updateText(element, `Received "${event.data}".`);
      } else {
	const elapsed = Date.now() - start;
	const message = `${initialMessage} Sent and received ${(totalBytes / (1024 * 1024)).toFixed()} Mbytes in ${elapsed.toLocaleString()} ms (${(totalBytes / (1024 * 1024 * elapsed/1000)).toFixed(1)} MB/s).`;
	this.updateText(element, message);
      }
      if (onFinished && (nReceived > this.nTestMessages)) {
	onFinished();
      }
    };
  }
  promiseDataHandled(data, element) { // Sets data.onmessage like generateTestDataHandler, but resolves when all data is in.
    return new Promise(resolve => {
      data.onmessage = this.generateTestDataHandler(element, resolve);
    });
  }
  async lanSend() {
    if (!this.send.hasAttribute('awaitScan')) {
      this.hide(this.instructions);
      if (!LOCAL_TEST) {
	this.hide(this.receiveInstructions);
	this.receive.toggleAttribute('disabled', true);
      }
      this.send.toggleAttribute('disabled', true);
      this.sendDataPromise = this.sender.createDataChannel(); // Kicks off negotiation.

      this.updateText(this.sendInstructions, 'Press "Start scanning" on the other device, and use it to read this qr code:');
      this.sendCode.size = this.shadow$('.column').offsetWidth;
      this.sendCode.sendObject(await this.sender.signals);
      setTimeout(() => this.send.scrollIntoView({block: 'start', behavior: 'smooth'}), 500);

      this.show(this.sendCode);
      this.send.toggleAttribute('awaitScan', true);
      this.updateText(this.send, "Receive other code");
    } else {
      this.send.toggleAttribute('disabled', true);
      this.hide(this.sendCode);
      this.show(this.sendVideo);
      this.updateText(this.sendInstructions, "Use this video to scan the qr code from the other device:");

      const scan = await this.scan(this.sendVideo.querySelector('video'),
				   _ => _,
				   LOCAL_TEST && this.receiveCode);
      this.sender.signals = scan;

      const data = await this.sendDataPromise;
      const received = this.promiseDataHandled(data, this.sendInstructions);
      this.hide(this.sendVideo);
      data.send(`Simulated history forked from initiator ${App.user}.`);
      const message = this.makeTestMessage();
      const drained = new Promise(resolve => {	
	data.onbufferedamountlow = resolve;
      });
      for (let i = 0; i < this.nTestMessages; i++) data.send(message);
      await Promise.all([received, drained]);
      setTimeout(() => {
	this.sender.close();
	this.send.toggleAttribute('awaitScan', false);
	this.updateText(this.send, "Start transfer");
	this.receive.toggleAttribute('disabled', false);
      }, 2e3);
    }
  }
  async lanReceive() {
    if (this.receive.hasAttribute('awaitScan')) {
      this.hide(this.instructions);
      if (!LOCAL_TEST) {
	this.hide(this.sendInstructions);
	this.send.toggleAttribute('disabled', true);
      }
      this.receiveDataPromise = new Promise(resolve => {
	this.receiver.peer.ondatachannel = event => resolve(event.channel);
      });

      this.receive.toggleAttribute('disabled', true);
      this.show(this.receiveVideo);
      this.updateText(this.receiveInstructions, "Use this video to scan the qr code from the other device:");

      this.receive.toggleAttribute('awaitScan', false);
      this.updateText(this.receive, "Continue after scanning on other device");
      if (!LOCAL_TEST) setTimeout(() => this.lanReceive());
    } else {
      this.receive.toggleAttribute('disabled', true);
      let unscrolled = true;
      const scan = await this.scan(this.receiveVideo.querySelector('video'),
				   () => unscrolled && !(unscrolled=false) && this.receiveInstructions.scrollIntoView({block: 'start', behavior: 'smooth'}),
				   LOCAL_TEST && this.sendCode);
      this.receiver.signals = scan;

      this.updateText(this.receiveInstructions, 'Press "Receive other code" on the other device, and use it to read this qr code:');
      this.receiveCode.size = this.shadow$('.column').offsetWidth;
      this.receiveCode.sendObject(await this.receiver.signals);
      this.hide(this.receiveVideo);
      this.show(this.receiveCode);
    
      const data = await this.receiveDataPromise;
      const received = this.promiseDataHandled(data, this.receiveInstructions);
      this.hide(this.receiveCode);
      data.send(`Simulated history forked from receiver ${App.user}.`);
      const message = this.makeTestMessage();
      const drained = new Promise(resolve => {
	data.onbufferedamountlow = resolve;
	setTimeout(resolve, 10e3); // Because the former doesn't always work well on iphone when other end initiated data channel.
      });
      for (let i = 0; i < this.nTestMessages; i++) data.send(message);
      await Promise.all([received, drained]);
      setTimeout(() => {
	this.receive.toggleAttribute('awaitScan', true);
	this.updateText(this.receive, "Start scanning");
	this.send.toggleAttribute('disabled', false);
	this.receiver.close();
      }, 2e3);
    }
  }
  afterInitialize() {
    super.afterInitialize();
    this.send.addEventListener('click', async event => await this.lanSend(event));
    this.receive.addEventListener('click', async event => await this.lanReceive(event));
    this.shadow$('#t1').addEventListener('click', () => window.open(this.wifi1));
    this.shadow$('#t2').addEventListener('click', () => window.open(this.wifi2));
    this.shadow$('#t0').addEventListener('click', () => window.open('mailto:howard.stearns@gmail.com'));
  }
  wifi1 = "WIFI:S:stearns;T:WPA;P:stearnsair;H:false;";
  wifi2 = "wifi://:stearnsair@stearns";
  get template() {
    return `
      <section>
        <p>Experimental data transfer: If you have two devices with cameras, you can try the following with or without first killing your WAN/Internet access. (You do have to have some sort of local LAN network going, such as WIFI.)</p>
<p>Test <a href="${this.wifi1}">one</a> or <a href="${this.wifi2}">two</a>, <a href="mailto:howard.stearns@gmail.com">mailto</a> or via javascript, <button id="t1">one</button> or <button id="t2">two</button> or test with  <button id="t0">mailto</button>.</p>
<app-qrcode data="${this.wifi1}"></app-qrcode>
<app-qrcode data="${this.wifi2}"></app-qrcode>
        <p id="instructions">To start, press "Start transfer" on one of the devices:</p>

        <div class="column">
          <md-filled-button id="send">Start transfer</md-filled-button>
          <p id="sendInstructions"></p>
          <app-qrcode id="sendCode" style="display:none"></app-qrcode>
          <slot name="sendVideo"></slot>          

          <md-filled-button id="receive" awaitScan>Start scanning</md-filled-button>
          <p id="receiveInstructions" style="display:none"></p>
          <app-qrcode id="receiveCode" style="display:none"></app-qrcode>
          <slot name="receiveVideo"></slot>
        </div>
      </section>
    `;
  }
  get styles() {
    return `
      section { margin: var(--margin, 10px); }
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
  }
}
FairshareTransaction.register();

class FairshareInvest extends MDElement {
  get template() {
    return `<p><i>Investing in a groups is not implemented yet, but see <a href="https://howard-stearns.github.io/FairShare/app.html?user=alice&groupFilter=&group=apples&payee=carol&amount=10&investment=-50&currency=fairshare#invest" target="fairshare-poc">proof of concept</a> in another tab.</i></p>`;
  }
}
FairshareInvest.register();


class FairshareCreateUser extends CreateUser {
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

class FairshareGroupProfile extends MDElement {
  get template() {
    return `
       <edit-group>
         <p>You can change the group name, picture, tax rate, and daily stipend. <i>(These changes take effect when you click "Go". In future versions, an average of each vote will be used)</i></p>
       </edit-group>`;
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
    return Credentials.create(App.user);
  }
  get tag() {
    return this.owner;
  }
  get exists() {
    if (!this.tag) return false;
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
    if (this.allowedTitle === this.title) return this.setUsernameValidity('');
    if (!await this.exists) return this.setUsernameValidity('');
    await this.setUsernameValidity("Already exists");
    console.warn(`${this.title} already exists.`);
    return false;
  }
  async onaction(target) {
    const data = Object.fromEntries(new FormData(target)); // Must be now, before await.
    if (!await this.checkUsernameAvailable()) return null;
    if (!data.picture.size) data.picture = this.picture;
    else data.picture = await AvatarImage.fileData(data.picture);
    // Credentials.owner is either already set (editing), or will be on next tick after setting group to the new tag,
    // but we need it set now for setGroup.
    Credentials.owner = data.owner = await this.owner;
    const tag = this.tag;
    await App.setGroup(tag, data); // Set the data, whether new or not.
    await this.parentComponent.onaction?.(target);
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
		  <input type="file" accept=".jpg,.jpeg,.png" name="picture" id="${this.formId}-picture"></input>
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
            </form>
	    <div slot="actions">
              <md-filled-button type="submit" form="${this.formId}" id="${this.formId}-submit"> <!-- cannot be a fab -->
                 Go
                 <material-icon slot="icon">login</material-icon>
              </md-filled-button>
	    </div>
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
