import { App, MDElement, ListTransform, ListItems } from './components.js';
import { Rule } from '@kilroy-code/rules';

const { localStorage } = window;

// Bug: groups.setKey([]) causes it to dissappear from tabs.

export class SwitchUser extends ListTransform { // A submenu populated from setKeys/getModel.
  isSwitchUser = true;
  get viewTag() {
    return 'menu-item';
  }
  get titleEffect() {
    return this.shadow$('md-sub-menu > md-menu-item[slot="item"] > div[slot="headline"]').textContent = this.title;
  }
  get template() {
    return `
      <md-sub-menu>
        <md-menu-item slot="item">
          <div slot="headline"></div>
          <material-icon slot="start">arrow_left</material-icon>
        </md-menu-item>
        <md-menu slot="menu"></md-menu>
      </md-sub-menu>
    `;
  }
  get itemParent() { // Overrides the default (which is the first content child.
    return this.shadow$('md-menu');
  }
  get copyContent() {
    return this.content.innerHTML;
  }
  get user() {
    return App?.url.searchParams.get('user') || this.myUsers[0] || '';
  }
  get userEffect() {
    console.log(`user set to ${this.user} among ${this.myUsers}. FIXME: Set user button image; distinguish in our menu.`);
    App.resetUrl(App.url.searchParams.set('user', this.user));
    return true;
  }
  get myUsers() {
    let found = JSON.parse(localStorage.getItem('myUsers') || '[]'); //fixme? "Alice", "Bob", "Carol"]');
    return found;
  }
  get myUsersEffect() {
    localStorage.setItem('myUsers', JSON.stringify(this.myUsers));
    return this.setKeys(this.myUsers);
  }
  afterInitialize() {
    super.afterInitialize();
    if (!App) console.warn("No App has been set for use by SwitchUser.");
    if (!this.user) {
      if (!this.myUsers.length) console.warn("No user has been set."); // Could be first time.
      return;
    }
    if (!this.myUsers.includes(this.user)) {
      if (!App.addUserScreen) console.warn("No AddUser facility.");
      return;
    }
  }
}
SwitchUser.register();

export class AppFirstuse extends MDElement {
  isFirstUse = true;
  storageKey = 'seenFirstUse';
  wasSeen() { return !!localStorage.getItem(this.storageKey); }
  setSeen() { localStorage.setItem(this.storageKey, true); return true; }
  get seen() {
    return this.wasSeen();
  }
  get seenEffect() {
    if (this.seen === this.wasSeen()) return true;
    if (this.seen) return this.setSeen();
    localStorage.clear();
    App.url.hash = this.title;
    App.resetUrl(App.url.search = '');
    return true;
  }
}
AppFirstuse.register();

export class UserProfile extends MDElement {
  get usernameElement() {
    return this.shadow$('[label="user name"]');
  }
  get username() {
    return this.usernameElement.value;
  }
  afterInitialize() {
    super.afterInitialize();
    this.shadow$('avatar-jdenticon').model = this;
    this.usernameElement.addEventListener('input', () => this.username = undefined);
    this.shadow$('md-outlined-button').onclick = () => this.shadow$('[type="file"]').click();
  }
  get template() {
    return `
      <div>
        <!-- autocomplete="username" -->
        <md-outlined-text-field required autocapitalize="words" label="user name" placeholder="visible to others"></md-outlined-text-field>

        <div class="avatar">
          <div>
            Avatar
            <md-outlined-button>Use photo</md-outlined-button>
            <input type="file" capture="user" accept="image/*"></input>
          </div>
          <avatar-jdenticon></avatar-jdenticon>
        </div>

       <md-outlined-text-field label="description" placeholder="displayed during membership voting"></md-outlined-text-field>

        Select three security questions. These are used to add your account to a new device, or to recover after wiping a device.
        <md-outlined-select required label="security question">
          <md-select-option value="0"><div slot="headline">What is your favorite color?</div></md-select-option>
         <md-select-option value="1"><div slot="headline">What is the airspeed velocity of an unladen swallow?</div></md-select-option>
        </md-outlined-select>
        <md-outlined-select required label="security question">
          <md-select-option value="0"><div slot="headline">What is your favorite color?</div></md-select-option>
         <md-select-option value="1"><div slot="headline">What is the airspeed velocity of an unladen swallow?</div></md-select-option>
        </md-outlined-select>
        <md-outlined-select required label="security question">
          <md-select-option value="0"><div slot="headline">What is your favorite color?</div></md-select-option>
         <md-select-option value="1"><div slot="headline">What is the airspeed velocity of an unladen swallow?</div></md-select-option>
        </md-outlined-select>
      </div>
    `;
  }
  get styles() {
    return `
      [type="file"] { display: none; }
      div {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 10px;
        margin: 10px;
      }
      .avatar {
         flex-direction: row;
      }
      .avatar > div { align-items: center; }

    `;
  }
}
UserProfile.register();


export class CreateUser extends MDElement {
  isCreateUser = true;
  get template() {
    return `<user-profile></user-profile>`;
  }
}
CreateUser.register();

export class AddUser extends MDElement {
  isAddUser = true;
}
AddUser.register();


////////////////
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
    return App?.url.searchParams.get('group') || this.myGroups[0] || '';
  }
  get groupEffect() {
    App.resetUrl(App.url.searchParams.set('group', this.group));
    document.body.querySelector('app-share').url = App.urlWith({screen: 'Groups', user: ''});
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


export class ToDo extends MDElement {
  get tagEffect() {
    this.prepend(this.tagName + '...');
    return this.firstChild;
  }
}
ToDo.register();

export class FairsharePay extends ToDo {
}
FairsharePay.register();

export class FairshareInvest extends ToDo {
}
FairshareInvest.register();

export class FairsharePayme extends ToDo {
}
FairsharePayme.register();


const users = window.users = {Alice: new User({title: 'Alice'}), Azalia: new User({title: "Azelia"}),  Bob: new User({title: 'Bob'}), Carol: new User({title: 'Carol'})};
const groups = window.groups = {Apples: new Group({title: 'Apples'}), Bananas: new Group({title: "Bananas"}), Coconuts: new Group({title: "Coconuts"}), FairShare: new Group({title: "FairShare", picture: "fairshare.webp"})};
document.querySelector('switch-user').getModel = key => users[key];
document.querySelector('fairshare-groups').getModel = key => groups[key];


