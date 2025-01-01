import { BasicApp, MenuButton, MenuItem, TabItem, ModelView, MDElement } from './components.js';
import { Rule } from '@kilroy-code/rules';

// Bug: groups.setKey([]) causes it to dissappear from tabs.

export class ListItem extends MDElement { // TODO: Unify this with AttachedView
  // A component that doesn't display anything - it creates and populates a view rule from a model,
  // and keeps the view consistent with the model.
  get model() {
    return null;
  }
  get view() {
    return document.createElement('md-list-item');
  }
  get titleEffect() {
    return this.view.textContent = this.view.dataset.key = this.model?.title;
  }
}
ListItem.register();

export class ListItems extends MDElement {
  // A list of items built from keys:
  // setKeys(array-of-keys) builds and maintains a set of ListItem children, where each child's model is getModel(key).
  // Our shadowTree is an md-list, with each child being and view of each ListItem.
  get template() {
    return `<md-list></md-list>`;
  }
  get view() {
    return this.shadow$('md-list');
  }
  getModel(key) {
    return {title: key};
  }
  setKeys(keys) { // Assumes that keys are ordered.
    let items = Array.from(this.children),
	  toRemove = items.filter(item => !keys.includes(item.dataset.key));
    toRemove.forEach(item => {
      item.view?.remove();
      item.remove();
    });
    items = Array.from(this.children);
    for (let keysIndex = 0, itemsIndex = 0; keysIndex < keys.length; keysIndex++) {
      const key = keys[keysIndex],
	    item = items[itemsIndex];
      if (item?.dataset.key === key) {
	itemsIndex++;
      } else {
	const insert = document.createElement('list-item');
	insert.model = this.getModel(key);
	insert.dataset.key = insert.view.dataset.key = key;
	if (item) {
	  item.before(insert);
	  this.view.children[itemsIndex].before(insert.view);
	} else {
	  this.append(insert);
	  this.view.append(insert.view);
	}
      }
    }
  }
}
ListItems.register();

export class SwitchUsers extends ListItems {
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

document.querySelector('list-items').setKeys(['Apples', 'Bananas', 'Coconuts']);
document.querySelector('switch-users').getModel = key => users[key];
document.querySelector('switch-users').setKeys(Object.keys(users));


export class FairsharePay extends ToDo {
}
FairsharePay.register();

export class FairshareInvest extends ToDo {
}
FairshareInvest.register();

export class FairsharePayme extends ToDo {
}
FairsharePayme.register();

