import { RuledElement } from '/@kilroy-code/ruled-components/index.mjs';
const {customElements, CustomEvent} = window; // Defined by browser.

export class MDElement extends RuledElement {
  get title() {
    return this.toCapitalCase(this.tagName.split('-').slice(1).join(' '));
  }
}
MDElement.register();

export class ModelView extends MDElement {
  get modelId() {
    return '';
  }
  get model() {
    return !this.modelId ? null : document.getElmentById(this.modelId);
  }
}
ModelView.register();

export class AttachedView extends ModelView {
  // A web component object that lives in a property or rule of a another web component, but does not itself
  // appear on the DOM (either directly or in a shadow dom). It's purpose is to generate an MD web component
  // because something (e.g., an md-menu) is looking specifically for a particular component (eg., an md-menu-item),
  // and there's no opportunity for us to supply our own directly. But this object controls the generated component
  // based on changes to the model.
  get content() { // Instead of a shadow dom tree, just answer a template element
    return this.fromHTML('template', this.template);
  }
  get view() {
    return this.content.content.firstElementChild; // First content is rule to get template, second gets dock fragment. No need to clone.
  }
  static create(model, key, viewParent) {
    const tag = customElements.getName(this),
	  instance = document.createElement(tag);
    // Appending to model serves two purposes:
    // 1) createElement() isn't enough to trigger all the machinery. The component needs to be connected to a dom.
    // 2) Being in the dom (even if no elements to display), keeps the instance from being garbage-collected.
    instance.setAttribute('slot', key); // key is meant to be unique among all the places that might use model children.
    model.append(instance);
    instance.model = model;
    viewParent.append(instance.view); // instance.view is not our child (under model), but rather a child of the viewParent.
  }
  static createViews(modelList, key, viewParent) {
    viewParent.innerHTML = '';
    for (let model of modelList) {
      if (model.getAttribute('role') === 'separator') {
	viewParent.append(model.cloneNode(true));
      } else {
	this.create(model, key, viewParent);
      }
    }
    return modelList;
  }
  child$(query) {
    return this.view.querySelector(query);
  }
}
AttachedView.register();

export class MenuItem extends AttachedView {
  get titleEffect() { // If model.title changes, update ourself in place (wherever we may appear).
    const headline = this.child$('[slot="headline"]');
    return headline.textContent = this.view.dataset.key = this.model?.title || '';
  }
  get template() {
    return `<md-menu-item><div slot="headline"></div></md-menu-item>`;
  }
}
MenuItem.register();

export class MenuButton extends MDElement {
  // Clicking the child element brings up a menu made from the models list.
  // Dispatches 'close-menu' event per https://material-web.dev/components/menu/#api
  get models() { // Menu is rebuilt if models changes, and items update when the the individual elements in models change properties.
    return [];
  }
  get anchor() { // Can be overridden or assigned.
    return this.slot.assignedElements()[0];
  }
  get slot() {
    const slot = this.shadow$('slot');
    slot.onslotchange = () => this.anchor = undefined;
    return slot;
  }
  get menu() {
    return this.shadowRoot.querySelector('md-menu'); //this.shadow$('md-menu');
  }
  get template() {
    return `
      <slot></slot>
      <md-menu></md-menu>
      `;
  }
  get modelsEffect() {
    MenuItem.createViews(this.models, 'menu-item', this.menu);
    return true;
  }
  afterInitialize() {
    this.menu.anchorElement = this.anchor;
    this.anchor.addEventListener('click', () => this.menu.open = !this.menu.open);
  }
}
MenuButton.register();

export class TabItem extends AttachedView {
  get titleEffect() {
    const primary = this.view;
    // if (this.view.active) location.hash = this.model.title; // Not of much use without persistence.
      return primary.textContent = primary.dataset.key = this.model?.title || '';
  }
  get template() {
    return `<md-primary-tab part="tab"></md-primary-tab>`;
  }
}
TabItem.register();

export class MenuTabs extends MDElement {
  // Works just like MenuButton but displays as an md-tabs.
  // As for MenuButton, the 'close-menu' event is fired when a new tab is selected.
  // In addition, one can call activateKey();
  get models() {
    return [];
  }
  get visibleModels() {
    return this.models;
  }
  activateKey(key) {
    // It is possible to call this before the md-primary-tab[data-key] is set by TabItem.titleEffect.
    // So we get the dataset.key from the corresponding model. Alternatively, we could go next tick,
    // but that would be awkward to debug.
    let index = 0;
    for (const tab of this.tabs.tabs) {
      tab.active = key === this.models[index++].dataset.key;
    }
  }
  get tabs() {
    return this.shadow$('md-tabs');
  }
  get template() {
    return `<md-tabs part="tabs"></md-tabs>`;
  }
  get modelsEffect() {
    TabItem.createViews(this.models, 'tab-item', this.tabs);
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
  afterInitialize() {
    this.tabs.addEventListener('change', event => {
      this.dispatchEvent(new CustomEvent('close-menu', {detail: {initiator: event.target.activeTab}, bubbles: true, composed: true}));
    });
  }
}
MenuTabs.register();

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
    this.shadow$('.screen-label').textContent = key;
    this.screens.forEach(screen => screen.style.display = (screen.title === key) ? '' : 'none');
    this.shadow$('menu-tabs').activateKey(key);
  }
  afterInitialize() {
    window.addEventListener('hashchange', () => this.onhashchange());
    this.shadow$('#user').models = this.shadow$('slot[name="user-menu"]').assignedElements();
    this.shadow$('#navigation').models = this.screens;
    const tabs = this.shadow$('menu-tabs');
    tabs.models = this.screens;
    tabs.visibleModels = this.shadow$('slot:not([name]').assignedElements().filter(e => e.getAttribute('role') !== 'separator');
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
    <span>${this.title}<span class="screen-label"></span></span>
    <menu-tabs></menu-tabs>
    <menu-button id="user">
      <md-icon-button><md-icon class="material-icons">account_circle</md-icon></md-icon-button>
    </menu-button>
  </header>
  <main>
    <slot name="first-use">Add content to appear on first use.</slot>
    <slot name="user-menu">Add content to appear in user menu.</slot>
    <slot>Add contentto appear as tabs.</slot>
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
  .screen-label::before { content: ": "; }
  @media (max-width:700px) { header > menu-tabs { display: none; } }
  @media (min-width:700px) { header .screen-label { display: none; } }
`;
  }
}
BasicApp.register();
