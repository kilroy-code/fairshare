import { App, MDElement, ListItems, MenuButton, BasicApp, ChooserButton, AppShare } from '@kilroy-code/ui-components';
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
}
FairshareApp.register();

class FairshareGroups extends ListItems {
  get group() {
    return App?.url.searchParams.get('group') || this.myGroups[0] || '';
  }
  get groupElement() {
    return this.transformers.find(item => item.dataset.key === this.group) || null;
  }
  get groupModel() {
    return this.groupElement?.model || null;
  }
  get groupModelEffect() {
    if (!this.groupModel) return false;
    if (this.groupModel.picture) {
      console.log('setting', this.group, this.groupModel.picture);
      this.shareElement.picture = `images/${this.groupModel.picture}`;
    }
    return true;
  }
  get shareElement() {
    return document.body.querySelector('app-share');
  }
  get groupEffect() {
    if (App.resetUrl({group: this.group})) {
      this.group = undefined; // Allow it to pick up new dependencies.
      this.shareElement.url = App.urlWith({screen: 'Groups', user: ''});
    }    
    return true;
  }
  get myGroups() {
    let found = JSON.parse(localStorage.getItem('myGroups') || '["Apples", "Bananas", "FairShare"]'); //fixme? []
    return found;
  }
  get myGroupsEffect() {
    localStorage.setItem('myGroups', JSON.stringify(this.myGroups));
    return this.setKeys(this.myGroups);
  }
}
FairshareGroups.register();

class FairshareGroupChooser  extends ChooserButton {
  get choice() {
    return App?.url.searchParams.get('group');
  }
  // TODO: unify this with ChooserButton.
  get groups() {
    return this.doc$('fairshare-groups');
  }
  get groupsEffect() {
    return this.setKeys(this.groups.myGroups);
  }
}
FairshareGroupChooser.register();
  
class FairsharePayme extends AppShare {
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


/*
const users = window.users = {
  Alice: new User({title: 'Alice'}),
  Azalia: new User({title: "Azelia"}),
  Bob: new User({title: 'Bob'}),
  Carol: new User({title: 'Carol'})
  };
*/
const users = {H: {title: 'H'}, 'howard.stearns': {title: 'howard.stearns'}};

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


