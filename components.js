import { RuledElement } from '/@kilroy-code/ruled-components/index.mjs';
import { Rule } from '@kilroy-code/rules';
const {customElements, CustomEvent, URL, localStorage, getComputedStyle} = window; // Defined by browser.

export let App;

export class MDElement extends RuledElement {
  get title() {
    return this.toCapitalCase(this.tagName.split('-').slice(1).join(' '));
  }
}
MDElement.register();

export class MaterialIcon extends MDElement {
  get template() {
    return `
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
      <md-icon class="material-icons"><slot></slot></md-icon>
    `;
  }
}
MaterialIcon.register();

export class AppQrcode extends MDElement {
  get data() { return (this.getRootNode().host.url || App?.url).href; }
  get picture() { return this.getRootNode().host.picture || ''; }
  get size() { return 300; }
  get color() { return getComputedStyle(this).getPropertyValue("--md-sys-color-on-secondary-container"); }
  get background() { return getComputedStyle(this).getPropertyValue("--md-sys-color-secondary-container"); }
  get dotsOptions() {
    return {
      color: this.color,
      type: "rounded"
    };
  }
  get backgroundOptions() {
    return {
      color: this.background
    };
  }
  get imageOptions() {
    return {
      imageSize: 0.3,
      margin: 6
    };
  }
  get options() {
    return {
      width: this.size,
      height: this.size,
      type: 'svg',
      data: this.data,
      image: this.picture,
      dotsOptions: this.dotsOptions,
      backgroundOptions: this.backgroundOptions,
      imageOptions: this.imageOptions
    };
  }
  get qrcodeModule() {
    return App.ensureScript({
      src: 'https://unpkg.com/qr-code-styling@1.5.0/lib/qr-code-styling.js',
      async: 'async'
    });
  }
  get generator() {
    return this.qrcodeModule.loaded ? new window.QRCodeStyling(this.options) : null;
  }
  get effect() {
    const container = this.content.firstElementChild;
    container.innerHTML = '';
    this.generator?.append(container); // Note that this is backwards to what you might think.
    return true;
  }
  get template() {
    return `<div></div>`;
  }
}
AppQrcode.register();

export class AvatarJdenticon extends MDElement {
  // Clients can assign username or model.
  get model() { return null; }
  get username() { return this.model?.username || ''; }
  get size() { return 80; }
  get usernameEffect() {
    return this.jdenticonModule?.updateSvg(this.jdenticonElement, this.username) || false;
  }
  get jdenticonElement() {
    return this.shadow$('svg');
  }
  get jdenticonModule() {
    const script = App.ensureScript({
      src: 'https://cdn.jsdelivr.net/npm/jdenticon@3.3.0/dist/jdenticon.min.js',
      async: 'async',
      integrity: 'sha384-LfouGM03m83ArVtne1JPk926e3SGD0Tz8XHtW2OKGsgeBU/UfR0Fa8eX+UlwSSAZ',
      crossorigin: 'anonymous'
    });
    if (!script.loaded) return null;
    return window.jdenticon;
  }
  get template() {
    return `<svg width="${this.size}" height="${this.size}"></svg>`;
  }
}
AvatarJdenticon.register();

export class AppShare extends MDElement {
  get url() {
    return App?.url;
  }
  get picture() {
    return '';
  }
  afterInitialize() {
    this.shadow$('md-filled-button').onclick = () => navigator.share({url: this.url, title: App.title});
  }
  get template() {
    return `
       <section>
          <slot name="qr"></slot>
          <app-qrcode></app-qrcode>

          <slot name="social"></slot>
          <div>
            <md-filled-button>
              <material-icon slot="icon">share</material-icon>
              share
            </md-filled-button>
          </div>
       </section>
    `;
  }
  get styles() {
    return `
      app-qrcode, div:has(md-filled-button) {
        margin-left: auto;
        margin-right: auto;
        display: block;
        width: fit-content;
      }
      section {margin: 10px; }
    `;
  }
}
AppShare.register();

export class ViewTransform extends MDElement { // TODO: Unify this with AttachedView
  // A component that doesn't display anything - it creates and populates a view rule from a model,
  // and keeps the view consistent with the model.
  get model() {
    return null;
  }
  get content() { // Instead of a shadow dom tree, just answer a template element
    return this.fromHTML('template', this.template);
  }
  get view() {
    return this.content.content.firstElementChild; // First content is rule to get template, second gets dock fragment. No need to clone.
  }
}
ViewTransform.register();

export class ListTransform extends MDElement {
  get itemParent() {
    return this.content.firstElementChild;
  }
  get models() { // Alternatively to supplying getModel and calling setModel, one can set the models
    return [];
  }
  get modelsEffect() {
    if (!this.models.length) return false;
    let keys = this.models.map(model => model.title);
    return this.setKeys(keys);
  }
  getModel(key) {
    return this.models.find(model => model.dataset.key === key) || {title: key};
  }
  get viewTag() {
    console.warn(`Please specifify a viewTag for ${this.title}.`);
    return '';
  }
  getViewTagChildren() { // Fresh list each time.
    return Array.from(this.children).filter(child => child.dataset.hasOwnProperty('key'));
  }
  setKeys(keys) { // Adds or removes viewTag elements to maintain ordered correspondence with keys.
    let items = this.getViewTagChildren(),
	toRemove = items.filter(item => !keys.includes(item.dataset.key));
    toRemove.slice().forEach(item => {
      item.view?.remove();
      item.remove();
    });
    items = this.getViewTagChildren();
    for (let keysIndex = 0, itemsIndex = 0; keysIndex < keys.length; keysIndex++) {
      const key = keys[keysIndex],
	    item = items[itemsIndex];
      if (item?.dataset.key === key) {
	itemsIndex++;
      } else {
	const insert = document.createElement(this.viewTag);
	insert.setAttribute('slot', 'transformer');
	insert.model = this.getModel(key);
	insert.dataset.key = insert.view.dataset.key = key;
	if (item) {
	  item.before(insert);
	  this.itemParent.children[itemsIndex].before(insert.view);
	} else {
	  this.append(insert);
	  this.itemParent.append(insert.view);
	}
      }
    }
    return keys;
  }
}
ListTransform.register();


export class ListDivider extends MDElement {
  get copyContent() {
    return this.content.innerHTML;
  }
  get template() {
    return `<md-divider role="separator" tabindex="-1"></md-divider>`;
  }
  get title() {
    return `divider-${Array.from(this.parentElement.children).indexOf(this)}`;
  }
}
ListDivider.register();

export class ListItem extends ViewTransform {
  get template() {
    return `<md-list-item></md-list-item>`;
  }
  get titleEffect() {
    return this.view.textContent = this.view.dataset.key = this.model?.title;
  }
}
ListItem.register();

export class ListItems extends ListTransform {
  // A list of items built from keys:
  // setKeys(array-of-keys) builds and maintains a set of ListItem children, where each child's model is getModel(key).
  // Our shadowTree is an md-list, with each child being and view of each ListItem.
  get template() {
    return `<md-list></md-list>`;
  }
  get viewTag() {
    return 'list-item';
  }
}
ListItems.register();


export class MenuItem extends ViewTransform {
  get template() {
    return this.model.copyContent || `<md-menu-item><div slot="headline"></div></md-menu-item>`;
  }
  get titleEffect() { // If model.title changes, update ourself in place (wherever we may appear).
    const headline = this.view.querySelector('[slot="headline"]'),
	  title = this.model?.title || '';
    this.view.dataset.key = title;
    if (!headline) return title;
    return headline.textContent = title;
  }
}
MenuItem.register();

export class MenuButton extends ListTransform {
  get slot() {
    const slot = this.shadow$('slot');
    slot.onslotchange = () => this.anchor = undefined;
    return slot;
  }
  get anchor() { // Can be overridden or assigned.
    return this.slot.assignedElements()[0];
  }
  get menu() {
    return this.itemParent;
  }
  get viewTag() {
    return 'menu-item';
  }
  get hasOverflow() {
    return false;
  }
  get template() {
    return `
      <md-menu${this.hasOverflow === '' ? ' has-overflow' : ''}></md-menu>
      <slot></slot>
      `;
  }
  afterInitialize() {
    super.afterInitialize();
    this.menu.anchorElement = this.anchor;
    this.anchor.addEventListener('click', () => this.menu.open = !this.menu.open);
  }
}
MenuButton.register();

export class TabItem extends ViewTransform {
  get template() {
    return `<md-primary-tab part="tab"></md-primary-tab>`;
  }
  get titleEffect() {
    const primary = this.view;
    // if (this.view.active) location.hash = this.model.title; // Not of much use without persistence.
      return primary.textContent = primary.dataset.key = this.model?.title || '';
  }
}
TabItem.register();

export class MenuTabs extends ListTransform {
  get viewTag() {
    return 'tab-item';
  }
  get template() {
    return `<md-tabs part="tabs"></md-tabs>`;
  }
  get tabs() {
    return this.shadow$('md-tabs');
  }
  activateKey(key) {
    let index = 0, models = this.models;
    for (const tab of this.tabs.tabs) {
      // It is possible to call this before the md-primary-tab[data-key] is set by TabItem.titleEffect.
      // So we get the dataset.key from the corresponding model.
      // Alternatively, we could go next tick, but that would be awkward to debug.
      tab.active = key === models[index++].dataset.key;
    }
  }
  afterInitialize() {
    super.afterInitialize();
    this.tabs.addEventListener('change', event => {
      this.dispatchEvent(new CustomEvent('close-menu', {detail: {initiator: event.target.activeTab}, bubbles: true, composed: true}));
    });
  }
  get visibleModels() {
    return this.models;
  }
  get modelsEffect() {
    super.__modelsEffect();
    // We don't have tabs children yet (wait for next tick, but collect the required values now in this dynamic extent.
    const {models, visibleModels, tabs} = this;
    setTimeout(() => {
      let index = 0;
      for (const tab of tabs.tabs) {
	const model = models[index++],
	      isVisible = visibleModels.includes(model);
	tab.style.display = isVisible ? '' : 'none';
      }
    });
    return true;
  }
}
MenuTabs.register();

export class BasicApp extends MDElement {
  constructor() {
    super();
    App = window.App = this;
  }
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
  findScreen(indicator) {
    return this.screens.find(screen => screen[indicator]);
  }
  get switchUserScreen() {
    return this.findScreen('isSwitchUser');
  }
  get addUserScreen() {
    return this.findScreen('isAddUser');
  }
  get createUserScreen() {
    return this.findScreen('isCreateUser');
  }
  get firstUseScreen() {
    return this.findScreen('isFirstUse');
  }
  get url() { // location.href, as a URL. Instead of assigning this, call resetUrl.
    return new URL(location.href);
  }
  urlWith(parameters) { // Answer a copy of url with parameters set appropriately. (E.g. screen => hash, and everything else in query params.)
    // As a special case, passing null clears all query parameters.
    const url = new URL(this.url.href);
    if (parameters === null) { // special case, to clear the parameters
      url.search = '';
      url.hash = '';
      return url;
    }
    for (const key in parameters) {
      const value = parameters[key];
      if (key === 'screen') url.hash = value;
      else url.searchParams.set(key, value);
    }
    return url;
  }
  resetUrl(parameters, updateHistory = true) { // After updating url as by urlWith(), this:
    // 1. resets url if there are any changes, so that anthing dependent on it can be recomputed.
    // 2. optionally adds to history if updateHistory and there are any changes.
    // Answers true if there is a change.
    const previous = this.url.href, // Before this change.
	  next = this.urlWith(parameters);
    console.log('resetUrl from:', previous, 'to:', next.href, parameters);
    if (previous === next.href) return false;
    this.url = new URL(next);
    if (!updateHistory) return true;
    const params = Object.fromEntries(next.searchParams.entries());
    params.screen = next.hash.slice(1);
    console.log('pushState', params);
    history.pushState(params, this.title, next.href);
    return true;
  }
  get screen() { // The currently displayed screen.
    return decodeURIComponent(this.url.hash.slice(1));
  }
  get screenEffect() { // Recononicalize url and screen.
    this.resetUrl({screen: this.screen});
    this.screen = undefined; // Allow it to be recomputed.
    this.shadow$('.screen-label').textContent = this.screen;
    this.shadow$('menu-tabs').activateKey(this.screen);
    // In this implementation, we make only the active screen visible.
    // Alternatives might, e.g., scroll down or across.
    this.screens.forEach(screen => screen.style.display = (screen.title === this.screen) ? '' : 'none');
    return true;
  }
  ensureScript(urlOrAttributes) { // Returns the specified script element, creating it if necessary.
    // Argument can be the url, or a dictionary of attributeName => value.
    // The returned script element will have a rule attached called 'loaded', that will reflect the actual loaded state.
    const attributes = urlOrAttributes.src ? urlOrAttributes : {src: urlOrAttributes};
    let script = this.headElement.querySelector(`[src="${attributes.src}"]`);
    if (script) return script;
    script = document.createElement('script');
    for (let name in attributes) script.setAttribute(name, attributes[name]);
    Rule.attach(script, 'loaded', () => false);
    script.onload = () => script.loaded = true;
    this.headElement.append(script);
    return script;
  }
  onhashchange() { // Set current screen to that defined by the hash.
    console.log('onhashchange', location.hash);
    this.resetUrl({screen: location.hash.slice(1)}, false);
  }
  onpopstate(event) {
    console.log('onpopstate', location.href, event.state);
    if (event.state) this.resetUrl(event.state, false);
  }
  afterInitialize() {
    super.afterInitialize();
    window.addEventListener('hashchange', event => this.onhashchange(event));
    window.addEventListener('popstate', event => this.onpopstate(event));
    const userMenuItems = this.shadow$('slot[name="user-menu"]').assignedElements();
    this.shadow$('#user').models = userMenuItems;
    this.shadow$('#navigation').models = this.screens.filter(s => !userMenuItems.includes(s));
    const tabs = this.shadow$('menu-tabs');
    tabs.models = this.screens;
    tabs.visibleModels = this.shadow$('slot:not([name]').assignedElements().filter(e => !(e instanceof ListDivider));

    const screenKeys = this.screens.map(s => s.dataset.key);
    this.addEventListener('close-menu', event => {
      const key = event.detail.initiator.dataset.key,
	    isScreen = screenKeys.includes(key);
      if (key === 'Firstuse') this.firstUseScreen?.set('seen', !this.firstUseScreen?.seen);
      if (isScreen) this.resetUrl({screen: key});
      // Unfortunately, I have not figured out how to intercept this at the submenu, so we need to trampoline.
      else this.switchUserScreen?.set('user', key);
    });

    // Initial state.
    if (location.hash) return setTimeout(() => this.onhashchange()); // Next tick, after things instantiate.
    const title = (this.firstUseScreen?.seen ? this.screens[0] : this.firstUseScreen).title;
    this.resetUrl({screen: title});
    return true;
  }
  get template() {
    return `
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <link href="style.css" rel="stylesheet">
  <header>
    <menu-button id="navigation">
      <md-icon-button><md-icon class="material-icons">menu</md-icon></md-icon-button>
    </menu-button>
    <span>${this.title}<span class="screen-label"></span></span>
    <menu-tabs></menu-tabs>
    <menu-button id="user" has-overflow>
      <md-icon-button>
         <material-icon>account_circle</material-icon>
      </md-icon-button>
    </menu-button>
  </header>
  <main>
    <slot name="first-use"><i>Add content to appear on first use.</i></slot>
    <slot name="user-menu"><i>Add content to appear in user menu.</i></slot>
    <slot><i>Add contentto appear as tabs.</i></slot>
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
  header, header md-icon, header material-icon, header menu-tabs::part(tab) {
    color: var(--md-sys-color-on-primary-container);
  }
  .screen-label::before { content: ": "; }
  @media (max-width:700px) { header > menu-tabs { display: none; } }
  @media (min-width:700px) { header .screen-label { display: none; } }
`;
  }
}
BasicApp.register();
