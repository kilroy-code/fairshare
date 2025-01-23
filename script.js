import { App, MDElement,  BasicApp, AppShare, CreateUser, MutableCollection, MenuButton, LiveList, AuthorizeUser } from '@kilroy-code/ui-components';
import { Rule } from '@kilroy-code/rules';

const { localStorage, URL } = window;


class User { // A single user, which must be one that the human has authorized on this machine.
  constructor(properties) { Object.assign(this, properties); }
  isLiveRecord = true;
  get title() { return 'unknown'; }
  get picture() { return ''; }
  get groups() { return ['FairShare']; }
}
Rule.rulify(User.prototype);


class Group { // A single group, of which the current user must be a member.
  constructor(properties) { Object.assign(this, properties); }
  isLiveRecord = true;
  get title() { return 'unknown'; }
  get picture() { return this.title.toLowerCase() + '.jpeg'; }
  get rate() { return 0.01; }
  get stipend() { return 1; }
  get divisions() { return 100; }
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
  get userCollection() { // The FairshareApp constructor gets the liveTags locally, before anything else.
    return new MutableCollection({getRecord: getUserData, getLiveRecord: getUserModel});
  }
  get liveUsersEffect() { // If this.userCollection.liveTags changes, write the list to localStorage for future visits.
    return this.setLocalLive('userCollection');
  }
  get groupCollection() { // As with userCollection, it is stable as a collection, but with liveTags changing.
    return new MutableCollection({getRecord: getGroupData, getLiveRecord: getGroupModel});
  }
  get group() {
    let param = this.getParameter('group');
    return param || this.groupCollection?.liveTags[0] || '';
  }
  getGroupTitle(key) { // Callers of this will become more complicated when key is a guid.
    return this.groupCollection[key]?.title || key;
  }
  get groupRecord() {
    let group = this.group;
    const groups = this.userRecord?.groups;
    if (!group || !groups) return null; // If either of the above changes, we'll recompute.
    if (!groups.includes(group)) { // If we're not in the requested group...
      const next = groups[0];
      if (!next) return null; // New user.
      this.alert(`${this.userRecord.title} is not a member of ${this.getGroupTitle(group)}. Switched to ${this.getGroupTitle(next)}.`);
      group = next;
      this.resetUrl({group});
    }
    this.groupCollection.updateLiveTags(groups); // Ensures that there are named rules for each group.
    return this.groupCollection[group];
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
    return this[collectionName].updateLiveTags(stored);
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
    return data;
  }
  get setUser() {
    return (tag, newData) => {
      return setUserData(tag, this.mergeData(this.userCollection[tag], newData));
    };
  }
  get setGroup() {
    return (tag, newData) => {
      const oldData = this.groupCollection[tag];
      const merged = this.mergeData(oldData, newData);
      delete merged.isLiveRecord;
      return setGroupData(tag, merged);
    };
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
  afterInitialize() {
    super.afterInitialize();
    // When we get the list from the network, it will contain those initial knownTags members from above
    // (unless deleted on server!), and when it comes in, that will (re-)define the total knownTags order.
    getUserList().then(knownTags => this.userCollection.updateKnownTags(knownTags));
    getGroupList().then(knownTags => this.groupCollection.updateKnownTags(knownTags));
  }
}
FairshareApp.register();

export class FairshareCreateUser extends CreateUser {
}
FairshareCreateUser.register();

class FairshareGroupsMenuButton  extends MenuButton { // Choose among this user's groups.
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
    App.resetUrl({group: tag});
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
  select(tag) { // Set label to choice.
    this.button.textContent = this.collection[this.choice].title;
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


class FairshareAmount extends MDElement {
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
    this.element.addEventListener('input', event => event.target.reportValidity() && (App.amount = parseFloat(event.target.value || '0')));
  }
}
FairshareAmount.register();

class FairshareAuthorizeUser extends AuthorizeUser {
}
FairshareAuthorizeUser.register();

class FairshareGroups extends LiveList {
  static async join(tag) {
    const groups = [...App.userRecord.groups, tag];
    // Add user to group. (Currently, as a full member.)
    let newGroupRecord = new Group(App.groupCollection[tag]); // A live group object, with defaults and operations.
    newGroupRecord.getBalance(App.user); // for side-effect of entering an initial balance
    await App.setGroup(tag, newGroupRecord); // Save with our presence.
    App.groupCollection.updateLiveTags(groups); // Not previously live.
    // Add tag to our groups.
    await App.setUser(App.user, {groups});
    await App.userCollection.updateLiveRecord(App.user);
    App.resetUrl({group: tag});
  }
  get collection() {
    return App.groupCollection;
  }
  get active() {
    return App.group;
  }
  get otherGroupsElement() {
    return this.child$('fairshare-all-other-groups-menu-button');
  }
  get joinElement() {
    return this.child$('md-filled-button');
  }
  get choiceEffect() {
    return this.joinElement.toggleAttribute('disabled', !this.otherGroupsElement.choice);
  }
  select(tag) {
    App.resetUrl({group: tag});
  }
  afterInitialize() {
    super.afterInitialize();
    this.joinElement.addEventListener('click', () => {
      const menu = this.otherGroupsElement;
      FairshareGroups.join(menu.choice);
      menu.choice = '';
      return true;
    });
  }
}
FairshareGroups.register();
  
class FairshareShare extends AppShare {
  get url() {
    return App.urlWith({user: '', payee: '', amount: '', screen: 'My Groups'});
  }
  get description() {
    return `Come join ${App.user} in ${App.group}!`;
  }
  get picture() {
    return App.getPictureURL(App.groupRecord?.picture);
  }
}
FairshareShare.register();

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

class FairsharePay extends MDElement {
  get amountElement() {
    return this.shadow$('fairshare-mount');
  }
  get payeeElement() {
    return this.shadow$('all-users-menu-button');
  }
  get payeeEffect() {
    const payee = this.payeeElement.choice;
    if (!payee) return '';
    return App.payee = payee;
  }
  get appPayeeEffect() {
    const record = App.userCollection[App.payee];
    if (!record) return '';
    return this.payeeElement.button.textContent = record.title;
  }
  get template() {
    return `
      <section>
        <div class="row">
          <fairshare-amount></fairshare-amount>
          <fairshare-groups-menu-button></fairshare-groups-menu-button>
          to
          <all-users-menu-button></all-users-menu-button>
        </div>
        <hr>
        <fairshare-transaction></fairshare-transaction>
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
    return App.groupRecord || new Group();
  }
  get amount() {
    return App.amount;
  }
  get fee() {
    return this.groupRecord.roundUpToNearest(this.groupRecord.rate * this.amount);
  }
  get cost() {
    if (App.user == App.payee) return this.fee;
    return this.groupRecord.roundUpToNearest(this.amount + this.fee);
  }
  get balanceBefore() {
    return this.groupRecord.getBalance(App.user) || 0;
  }
  get balanceAfter() {
    return this.groupRecord.roundDownToNearest(this.balanceBefore - this.cost);
  }
  get paymentEffect() {
    this.shadow$('#balanceBefore').textContent = this.balanceBefore;
    this.shadow$('#cost').textContent = this.cost;
    this.shadow$('#group').textContent = this.groupRecord.title;
    this.shadow$('#rate').textContent = this.groupRecord.rate;
    this.shadow$('#balanceAfter').textContent = this.balanceAfter;
    this.shadow$('#pay').toggleAttribute('disabled', this.balanceAfter < 0);
    return true;
  }
  get template() {
    return `
       your balance: <span id="balanceBefore"></span><br/>
       cost with fee: -<span id="cost"></span> (<span id="group"></span> rate: <span id="rate"></span>)
       <hr>
       balance after: <span id="balanceAfter"></span>
       <md-filled-button id="pay" disabled>Pay</md-filled-button>
    `;
  }
  afterInitialize() {
    super.afterInitialize();
    this.shadow$('#pay').addEventListener('click', () => {
      this.groupRecord.adjustBalance(App.user, -this.cost);
      if (App.user !== App.payee) this.groupRecord.adjustBalance(App.payee, this.amount);
      App.setGroup(App.group, this.groupRecord);
      App.resetUrl({amount:''});
    });
  }
}
FairshareTransaction.register();

class FairshareInvest extends MDElement {
  get template() {
    return `<p><i>Investing in a groups is not implemented yet, but see <a href="https://howard-stearns.github.io/FairShare/app.html?user=alice&groupFilter=&group=apples&payee=carol&amount=10&investment=-50&currency=fairshare#invest" target="fairshare-poc">proof of concept</a>.</i></p>`;
  }
}
FairshareInvest.register();

// Some data for populating the db, local or remote.
const users = window.users = {
  Alice: new User({title: 'Alice'}),
  //Azalia: new User({title: "Azelia"}),
  Bob: new User({title: 'Bob', picture: 'bob.png'}),
  Carol: new User({title: 'Carol'})
  };
//const users = {H: {title: 'H'}, 'howard.stearns': {title: 'howard.stearns'}};
const groups = window.groups = {
  Apples: new Group({title: 'Apples'}),
  Bananas: new Group({title: "Bananas"}),
  Coconuts: new Group({title: "Coconuts"}),
  FairShare: new Group({title: "FairShare", picture: "fairshare.webp"})
};

/*
// Local definitions
function getUserModel(key) { return Promise.resolve(users[key]); }
function getGroupModel(key) { return new Promise(resolve => setTimeout(() => resolve(groups[key]), 1000)); }

*/
// Networked definitions
function dataPath(collection, key) {
  return `/persist/${collection}/${key}.json`;
}
async function getData(collection, key) {
  const pathname = dataPath(collection, key);
  const response = await fetch(pathname);
  if (!response.ok) return null;
  const data = await response.json();
  return data;
}
async function setData(collection, key, data) {
  const path = dataPath(collection, key),
	response = await fetch(path, {
	  body: JSON.stringify(data),
	  method: 'POST',
	  headers: {"Content-Type": "application/json"}
	});
  if (!response.ok) {
    console.warn(`set ${collection} ${key}: ${response.statusText}`);
    return null;
  }
  const result = await response.json();
  return result;
}

async function getUserModel(key) {
  const data = await getData('user', key),
	model = new User(data);
  return model;
}
async function getGroupModel(key) {
  const data = await getData('group', key),
	model = new Group(data);
  return model;
}

function setUserData(key, data) {
  return setData('user', key, data);
}
function setGroupData(key, data) {
  return setData('group', key, data);
}
function getUserData(key) {
  return getData('user', key);
}
function getGroupData(key) {
  return getData('group', key);
}
function getUserList() {
  return getData('user', 'list');
}
function getGroupList() {
  return getData('group', 'list');
}

function getModelData(model) {
  let {title, picture} = model;
  return {title, picture};
}
function populateDb() {
  for (const key in users) {
    setUserData(key, getModelData(users[key]));
  }
  for (const key in groups) {
    setGroupData(key, getModelData(groups[key]));
  }
}
Object.assign(window, {getData, setData, getUserData, getGroupData, setUserData, setGroupData, getUserModel, getGroupModel, getModelData, populateDb, getUserList, getGroupList});
//*/
		   

// fixme: remove in favor of above
//document.querySelector('switch-user').getModel = getUserModel;
//document.querySelector('fairshare-groups').getModel = getGroupModel;

