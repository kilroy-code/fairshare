import { App, MDElement, ListItems, MenuButton } from '@kilroy-code/ui-components';
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

export class FairshareGroups extends ListItems {
  get group() {
    //console.log('group url:', App?.url.href);
    return App?.url.searchParams.get('group') || this.myGroups[0] || '';
  }
  get shareElement() {
    return document.body.querySelector('app-share');
  }
  get groupEffect() {
    //console.log('groupEffect:', this.group, App?.url.href);
    App.resetUrl({group: this.group});
    this.group = undefined; // Allow it to pick up new dependencies.
    this.shareElement.url = App.urlWith({screen: 'Groups', user: ''});
    this.shareElement.picture = `images/${this.getModel(this.group).picture}`;
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

export class FairshareGroupChooser extends MenuButton {
  // TODO: unify this with ChooserButton.
  get groups() {
    return this.doc$('fairshare-groups');
  }
  get groupsEffect() {
    return this.setKeys(this.groups.myGroups);
  }
  get button() {
    return null;
  }
  get groupEffect() {
    if (!this.button) return null;
    return this.button.textContent = this.groups.group;
  }
  afterInitialize() {
    const button = document.createElement('md-outlined-button');
    this.button = button;
    this.append(button);
    this.addEventListener('close-menu', event => {
      event.stopPropagation();
      this.groups.group = event.detail.initiator.dataset.key;
    });
    super.afterInitialize();
  }
  get styles() {
    return `:host { position: relative; }`;
  }
}
FairshareGroupChooser.register();
  

export class FairsharePay extends MDElement {
  get template() {
    return `<p><i>Paying another user is not implemented yet, but see <a href="https://howard-stearns.github.io/FairShare/app.html?user=alice&groupFilter=&group=apples&payee=carol&amount=10&investment=-50&currency=fairshare#pay" target="fairshare-poc">proof of concept</a></i></p>`;
  }
}
FairsharePay.register();

export class FairshareInvest extends MDElement {
  get template() {
    return `<p><i>Investing in a groups is not implemented yet, but see <a href="https://howard-stearns.github.io/FairShare/app.html?user=alice&groupFilter=&group=apples&payee=carol&amount=10&investment=-50&currency=fairshare#invest" target="fairshare-poc">proof of concept</a></i></p>`;
  }
}
FairshareInvest.register();

export class FairsharePayme extends MDElement {
  get template() {
    return `<p><i>Investing in a groups is not implemented yet, but see <a href="https://howard-stearns.github.io/FairShare/app.html?user=alice&groupFilter=&group=apples&payee=carol&amount=10&investment=-50&currency=fairshare#payme" target="fairshare-poc">proof of concept</a> and similar behavior already implemented <a href="#Share">in this app</a></i></p>`;
  }
}
FairsharePayme.register();


const users = window.users = {
  Alice: new User({title: 'Alice'}),
  Azalia: new User({title: "Azelia"}),
  Bob: new User({title: 'Bob'}),
  Carol: new User({title: 'Carol'})
};

const groups = window.groups = {
  Apples: new Group({title: 'Apples'}),
  Bananas: new Group({title: "Bananas"}),
  Coconuts: new Group({title: "Coconuts"}),
  FairShare: new Group({title: "FairShare", picture: "fairshare.webp"})
};

document.querySelector('switch-user').getModel = key => users[key];
/*
document.querySelector('switch-user').getModel = async key => {
  const pathname = `/persist/user/${key}.json`;
  const response = await fetch(pathname);
  const model = await response.json();
  console.warn({key, pathname, response, model});
  return model;
};  //users[key];
*/
document.querySelector('fairshare-groups').getModel = key => groups[key];


