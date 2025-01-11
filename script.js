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
  afterInitialize() {
    super.afterInitialize();
    const element = this.shadow$('md-outlined-text-field');
    element.addEventListener('change', event => event.target.reportValidity());
    element.addEventListener('input', event => event.target.checkValidity() && App.resetUrl({amount: event.target.value}));
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


const users = window.users = {
  Alice: new User({title: 'Alice'}),
  Azalia: new User({title: "Azelia"}),
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

//document.querySelector('switch-user').getModel = key => users[key];
document.querySelector('switch-user').getModel = key => Promise.resolve(users[key]);
/*
document.querySelector('switch-user').getModel = async key => {
  const pathname = `/persist/user/${key}.json`;
  const response = await fetch(pathname);
  const model = await response.json();
  console.warn({key, pathname, response, model});
  return model;
};  //users[key];
*/
document.querySelector('fairshare-groups').getModel = key => new Promise(resolve => setTimeout(() => resolve(groups[key]), 1000)); //Promise.resolve(groups[key]);


