import { BasicApp, MDElement, ListTransform } from './components.js';
import { Rule } from '@kilroy-code/rules';

// Bug: groups.setKey([]) causes it to dissappear from tabs.

export class SwitchUsers extends ListTransform { // A submenu populated from setKeys/getModel.
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
  get itemParent() {
    return this.shadow$('md-menu');
  }
  get copyContent() {
    return this.content.innerHTML;
  }
}
SwitchUsers.register();


export class ToDo extends MDElement {
  get tagEffect() {
    this.prepend(this.tagName + '...');
    return this.firstChild;
  }
}
ToDo.register();

export class AppFirstuse extends ToDo {
}
AppFirstuse.register();

export class UserProfile extends ToDo {
}
UserProfile.register();


export class AddUser extends ToDo {
}
AddUser.register();

export class CreateUser extends ToDo {
}
CreateUser.register();

export class UserMenu extends ToDo {
}
UserMenu.register();

export class AboutApp extends ToDo {
}
AboutApp.register();


////////////////

class User {
  constructor(properties) { Object.assign(this, properties); }
  get title() { return 'x'; }
  get picture() { return this.title.toLowerCase() + '.jpeg'; }
}
Rule.rulify(User.prototype);
const users = window.users = {Alice: new User({title: 'Alice'}), Bob: new User({title: 'Bob'}), Carol: new User({title: 'Carol'})};
const personas = Object.keys(users);

document.querySelector('list-items').setKeys(['Apples', 'Bananas', 'Coconuts']);
document.querySelector('switch-users').getModel = key => users[key];
document.querySelector('switch-users').setKeys(personas);


export class FairsharePay extends ToDo {
}
FairsharePay.register();

export class FairshareInvest extends ToDo {
}
FairshareInvest.register();

export class FairsharePayme extends ToDo {
}
FairsharePayme.register();

