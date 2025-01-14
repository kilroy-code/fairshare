import { App, MDElement, ListItems, BasicApp, ChooserButton, AppShare, ChoiceAmongLocallyStoredOptions, MutableCollection, LiveRecord, CollectionTransform } from '@kilroy-code/ui-components';
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

  get userCollection() {
    return new MutableCollection();
  }
  get groupCollection() {
    return new MutableCollection();
  }
 
  // FIXME trash these? (In favor of above.)
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


export class BaseTransformer extends MDElement {
  get content() { 
    return this.fromHTML('template', this.template);
  }
  get view() {
    return this.content.content.firstElementChild; // First content is rule to get template, second gets dock fragment. No need to clone.
  }
  get sideEffects() {
    const tag = this.dataset.key;
    this.view.querySelector('[slot="headline"]').textContent = this.model?.title || tag;

    return this.view.dataset.key = tag;
  }
}
BaseTransformer.register();

export class MenuTransformer extends BaseTransformer {
  get template() {
    return `<md-menu-item><div slot="headline"></div></md-menu-item>`;
  }
}
MenuTransformer.register();

export class MenuButton extends MDElement {
  get tagsEffect() {
    return this.transform.transformers;
  }
  get transform() {
    return new CollectionTransform({source: this, transformerTag: 'menu-transformer'});
  }
  get viewParent() {
    return this.shadow$('md-menu');
  }
  get anchor() { // Can be overridden or assigned.
    return this.shadow$('md-outlined-button');
  }
  get template() {
    return `
      <md-menu></md-menu>
      <md-outlined-button>Add existing to this browser</md-outlined-button>
      `;
  }
  get styles() {
    return `:host { position: relative; }`;
  }
  afterInitialize() {
    super.afterInitialize();
    this.viewParent.anchorElement = this.anchor;
    this.anchor.addEventListener('click', () => this.viewParent.open = !this.viewParent.open);
  }
}
MenuButton.register();

export class AllUsersMenuButton extends MenuButton {
  get collection() {
    return App.userCollection;
  }
  get tags() {
    return this.collection.knownTags;
  }
  afterInitialize() {
    super.afterInitialize();
    this.addEventListener('close-menu', event => {
      event.stopPropagation();
      console.log('selected:', event.detail.initiator.dataset.key);
      //this.choice = event.detail.initiator.dataset.key;
    });
  }
}
AllUsersMenuButton.register();


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
  afterInitialize() {
    super.afterInitialize();
    getGroupList().then(keys => this.setKeys(keys));
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

getUserList().then(knownTags => App.userCollection.updateKnownTags(knownTags, tag => getData('user', tag)));
getGroupList().then(knownTags => App.groupCollection.updateKnownTags(knownTags, tag => getData('group', tag)));
		   

// fixme: remove in favor of above
document.querySelector('switch-user').getModel = getUserModel;
document.querySelector('fairshare-groups').getModel = getGroupModel;


