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
    //console.log({key, model, viewParent, tag, instance, view: instance.view});
    // Appending to model serves two purposes:
    // 1) createElement() isn't enough to trigger all the machinery. The component needs to be connected to a dom.
    // 2) Being in the dom (even if no elements to display), keeps the instance from being garbage-collected.
    model.append(instance);
    instance.model = model;
    viewParent.append(instance.view); // instance.view is not our child (under model), but rather a child of the viewParent.
  }
  static createViews(modelList, key, viewParent) {
    viewParent.innerHTML = '';
    for (let model of modelList) {
      this.create(model, key, viewParent);
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
    MenuItem.createViews(this.models, 'user-menu', this.menu);    
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
