import { App, MDElement, ListItems, MenuButton, BasicApp, ChooserButton, AppShare, ChoiceAmongLocallyStoredOptions } from '@kilroy-code/ui-components';
import { Rule } from '@kilroy-code/rules';

const { localStorage, URL } = window;


class User {
  constructor(properties) { Object.assign(this, properties); }
  get title() { return 'unknown'; }
  get picture() { return this.title.toLowerCase() + '.jpeg'; }
}
Rule.rulify(User.prototype);


class Group {
  constructor(properties) { Object.assign(this, properties); }
  get title() { return 'unknown'; }
  get picture() { return this.title.toLowerCase() + '.jpeg'; }
}
Rule.rulify(Group.prototype);

class FairshareApp extends BasicApp {
  get title() {
    return 'FairShare';
  }
  get group() {
    return this.getParameter('group');
  }
  get payee() {
    return this.getParameter('payee');
  }
  get amount() {
    return parseFloat(this.getParameter('amount') || '0');
  }
  get groupScreen() {
    return this.doc$('fairshare-groups');
  }
  getGroupModel(key = this.group) {
    return this.groupScreen?.getCachedModel(key);
  }
  getGroupPictureURL(key = this.group) {
    return this.getPictureURL(this.getGroupModel(key)?.picture);
  }
}
FairshareApp.register();

class FairshareAmount extends MDElement {
  get template() {
    return `<md-outlined-text-field label="Amount" name="amount" type="number" min="0" step="0.01" placeholder="unspecified"></md-outlined-text-field>`;
  }
  get element() {
    return this.shadow$('md-outlined-text-field');
  }
  get amountEffect() {
    if (App.amount) this.element.value = App.amount;
    return true;
  }
  afterInitialize() {
    super.afterInitialize();
    this.element.addEventListener('change', event => event.target.reportValidity());
    this.element.addEventListener('input', event => event.target.checkValidity() && App.resetUrl({amount: event.target.value}));
  }
}
FairshareAmount.register();

class FairshareGroups extends ChoiceAmongLocallyStoredOptions {
  get urlKey() {
    return 'group';
  }
}
FairshareGroups.register();

class FairshareGroupChooser  extends ChooserButton {
  get choice() {
    return App?.url.searchParams.get('group');
  }
  get choiceEffect() {
    super.__choiceEffect();
    return App.resetUrl({group: this.choice});
  }
}
FairshareGroupChooser.register();
  
class FairshareShare extends AppShare {
  get url() {
    return App.urlWith({user: '', payee: '', amount: ''});
  }
  get description() {
    return `Come join ${App.user} in ${App.group}!`;
  }
  get picture() {
    return App.getGroupPictureURL();
  }
}
FairshareShare.register();

class FairsharePayme extends AppShare {
  get url() {
    return App.urlWith({user: '', payee: App.user, amount: App.amount || ''});
  }
  get description() {
    return App.amount ?
      `Please pay ${App.amount} ${App.group} to ${App.user}.` :
      `Please pay ${App.group} to ${App.user}.`;
  }
  get picture() {
    return App.getUserPictureURL();
  }
}
FairsharePayme.register();

class FairsharePay extends MDElement {
  get template() {
    return `<p><i>Paying another user is not implemented yet, but see <a href="https://howard-stearns.github.io/FairShare/app.html?user=alice&groupFilter=&group=apples&payee=carol&amount=10&investment=-50&currency=fairshare#pay" target="fairshare-poc">proof of concept</a></i></p>`;
  }
}
FairsharePay.register();

class FairshareInvest extends MDElement {
  get template() {
    return `<p><i>Investing in a groups is not implemented yet, but see <a href="https://howard-stearns.github.io/FairShare/app.html?user=alice&groupFilter=&group=apples&payee=carol&amount=10&investment=-50&currency=fairshare#invest" target="fairshare-poc">proof of concept</a></i></p>`;
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
  const data = await response.json();
  return data;
}
async function setData(collection, key, data) {
  const path = dataPath(collection, key),
	response = await fetch(path, {
	  body: JSON.stringify(data),
	  method: 'POST',
	  headers: {"Content-Type": "application/json"}
	}),
	result = await response.json();
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
Object.assign(window, {getData, setData, setUserData, setGroupData, getUserModel, getGroupModel, getModelData, populateDb, getUserList, getGroupList});

//*/
document.querySelector('switch-user').getModel = getUserModel;
document.querySelector('fairshare-groups').getModel = getGroupModel;


