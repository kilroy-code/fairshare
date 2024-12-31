import { MenuButton, MenuItem, TabItem, MDElement } from './components.js';

export class BasicApp extends MDElement {
  get htmlElement() {
    return this.doc$('html');
  }
  get headElement() {
    return this.doc$('html > head');
  }
  get langEffect() { // If html[lang] is not set, set it from this.lang rule, and return whatever value is used.
    // Note: does not change html[lang] once set, even if code assigns this.lang.
    const key = 'lang';
    if (this.htmlElement.hasAttribute(key)) return this.htmlElement.getAttribute(key);
    this.htmlElement.setAttribute(key, this.lang);
    return this.lang;
  }
  get title() { // Priority is overriding rule, the element's attribute, the head title content, or hostname.
    return this.doc$('html > head > title')?.textContent || location.hostname;
  }
  get titleEffect() { // Ensure there is a head title element.
    // Note: does not change html>head>title once it exists, even if code assigns this.title.
    return this.headElement.querySelector('title') || this.maybeAppend('title', this.headElement);
  }
  get viewportEffect() { // Ensure there is a mobile-ready head vieport element.
    let viewport = this.doc$('html > head > meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.setAttribute('name', 'viewport');
      viewport.setAttribute('content', 'initial-scale=1, width=device-width');
      this.headElement.append(viewport);
    }
    return viewport;
  }
  get screens() {
    return Array.from(this.children);
  }
  get screensEffect() {
    this.screens.forEach(screen => screen.dataset.key = screen.title);
    return true;
  }
  onhashchange() {
    let key = decodeURIComponent(location.hash.slice(1));
    this.screens.forEach(screen => screen.style.display = (screen.title === key) ? '' : 'none');
    this.shadow$('menu-tabs').activateKey(key);
  }
  afterInitialize() {
    window.addEventListener('hashchange', () => this.onhashchange());
    this.shadow$('#user').models = this.shadow$('slot[name="user-menu"]').assignedElements();
    this.shadow$('#navigation').models = this.screens;
    const tabs = this.shadow$('menu-tabs');
    tabs.models = this.screens;
    tabs.visibleModels = this.shadow$('slot:not([name])').assignedElements();
    this.addEventListener('close-menu', event => location.hash = event.detail.initiator.dataset.key);
    if (location.hash) setTimeout(() => this.onhashchange()); // Next tick, after things instantiate.
    else location.hash = this.screens[0].title;
  }
  get template() {
    return `
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <link href="style.css" rel="stylesheet">
  <header>
    <menu-button id="navigation">
      <md-icon-button><md-icon class="material-icons">menu</md-icon></md-icon-button>
    </menu-button>
    ${this.title}
    <menu-tabs></menu-tabs>
    <menu-button id="user">
      <md-icon-button><md-icon class="material-icons">account_circle</md-icon></md-icon-button>
    </menu-button>
  </header>
  <main>
    <slot name="user-menu"></slot>
    <slot name="first-use"></slot>
    <slot>Add content as children.</slot>
  </main>
`;
  }
  get styles() {
    return `
  header {
    background-color: var(--md-sys-color-primary-container);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  header > menu-tabs {
    --md-primary-tab-container-color: var(--md-sys-color-primary-container);
    --md-primary-tab-active-indicator-color: var(--md-sys-color-on-primary-container);
    --md-primary-tab-icon-color: var(--md-sys-color-on-primary-container);
  }
  header, header md-icon, header menu-tabs::part(tab) {
    color: var(--md-sys-color-on-primary-container);
  }
`;
  }
}
BasicApp.register();
window.BasicApp = BasicApp;

export class ListItems extends MDElement {
  get template() {
    return `<ul><slot></slot></ul>`;
  }
  // get handler() {
  //   return new Function('return ' + (this.ondata || '[]'));
  // }
  get models() {
    return []; //this.handler();
  }
  keys = [];
  getKey = (modelOrKey) => modelOrKey.key || modelOrKey;
  get itemEffect() {
    this.innerHTML = '';
    this.models.forEach(modelOrKey =>
      this.maybeAppend('li', this, modelOrKey).dataset.key = this.getKey(modelOrKey)
    );
    return this.children;
  }
}
ListItems.register();

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

export class SwitchUsers extends ToDo {
}
SwitchUsers.register();

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

document.querySelector('list-items').models = ['apples', 'bananas', 'coconuts'];
//window.getGroups = () => ['apples', 'bananas', 'coconuts'];

export class FairsharePay extends ToDo {
}
FairsharePay.register();

export class FairshareInvest extends ToDo {
}
FairshareInvest.register();

export class FairsharePayme extends ToDo {
}
FairsharePayme.register();

