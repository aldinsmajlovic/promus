import { TestbedHarnessEnvironment } from "@angular/cdk/testing/testbed";
import {
  importProvidersFrom,
  provideAppInitializer,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { MATERIAL_ANIMATIONS } from "@angular/material/core";
import { MatFormFieldHarness } from "@angular/material/form-field/testing";
import { MatInputHarness } from "@angular/material/input/testing";
import { MatMenuHarness } from "@angular/material/menu/testing";
import { MatSnackBarHarness } from "@angular/material/snack-bar/testing";
import { provideRouter } from "@angular/router";
import { TranslocoTestingModule } from "@jsverse/transloco";
import { newId } from "@promus/shared";
import { describe, expect, it, vi } from "vitest";
import sv from "../../../i18n/sv.json";
import { CurrentList } from "../../core/current-list";
import { PromusDb } from "../../core/db";
import { registerIcons } from "../../core/icons";
import { SessionService } from "../../core/session";
import { Store } from "../../core/store";
import { SyncService, type SyncStatus } from "../../core/sync.service";
import { ListMenu } from "./list-menu";

async function setup(second = true) {
  const db = new PromusDb(`menu-${newId()}`);
  await db.setMeta("session", {
    userId: newId(),
    username: "anna",
    householdId: newId(),
  });
  const status = signal<SyncStatus>({ kind: "idle", pending: 0, rejected: 0 });
  TestBed.configureTestingModule({
    providers: [
      { provide: PromusDb, useValue: db },
      {
        provide: SyncService,
        useValue: {
          status,
          syncNow: vi.fn(async () => undefined),
          soon: () => undefined,
        },
      },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideRouter([]),
      provideAppInitializer(registerIcons),
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { sv },
          translocoConfig: { availableLangs: ["sv"], defaultLang: "sv" },
          preloadLangs: true,
        }),
      ),
    ],
  });
  const store = TestBed.inject(Store);
  await TestBed.inject(SessionService).load();
  await store.load();
  const { listId } = await store.createList("Inköpslista");
  if (second) await store.createList("Helg");
  await db.setMeta("currentListId", listId);
  const current = TestBed.inject(CurrentList);
  const fixture = TestBed.createComponent(ListMenu);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const menu = await loader.getHarness(MatMenuHarness);
  return { db, store, current, listId, fixture, el, loader, menu };
}

type T = Awaited<ReturnType<typeof setup>>;

const text = (el: Element | null) =>
  el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const items = (t: T) => [
  ...document.querySelectorAll<HTMLElement>(
    '.mat-mdc-menu-panel [role^="menuitem"]',
  ),
];
const item = (t: T, label: RegExp) =>
  items(t).find((i) => label.test(text(i)))!;
const input = () =>
  document.querySelector<HTMLInputElement>(".mat-mdc-menu-panel input")!;

async function typeName(t: T, name: string) {
  const field = await t.loader.getHarness(MatFormFieldHarness);
  const control = (await field.getControl(MatInputHarness))!;
  await control.setValue(name);
  return { field, control };
}

async function enter(t: T) {
  input().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await t.fixture.whenStable();
}

describe("ListMenu", () => {
  it("lists every list with its count, the current one checked", async () => {
    const t = await setup();
    await t.store.addByName(t.listId, "Mjölk");
    await t.fixture.whenStable();
    expect(text(t.el.querySelector("button"))).toBe("Inköpslista");
    await t.menu.open();
    const rows = items(t).slice(0, 2);
    expect(rows.map((r) => text(r))).toEqual(["Helg0", "Inköpslista1"]);
    expect(rows.map((r) => r.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);
    expect(rows.map((r) => r.classList.contains("selected"))).toEqual([
      false,
      true,
    ]);
    expect(text(items(t)[2] ?? null)).toBe("Ny lista");
  });

  it("picking a list switches to it", async () => {
    const t = await setup();
    await t.menu.open();
    await t.menu.clickItem({ text: /^Helg/ });
    await t.fixture.whenStable();
    expect(text(t.el.querySelector("button"))).toBe("Helg");
    expect(t.current.list()?.name).toBe("Helg");
    expect(await t.menu.isOpen()).toBe(false);
  });

  it("New list turns into a field; Enter creates the list and switches to it", async () => {
    const t = await setup();
    await t.menu.open();
    item(t, /^Ny lista/).click();
    await t.fixture.whenStable();
    expect(document.activeElement).toBe(input());
    expect(input().placeholder).toBe("Namnge den nya listan");

    await typeName(t, "Lidl");
    await enter(t);
    expect(t.current.list()?.name).toBe("Lidl");
    expect(await t.menu.isOpen()).toBe(false);
    const snackBar = await t.loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe("Listan skapad");
    expect(await snackBar.getActionDescription()).toBe("Ångra");
  });

  it("typing in the field stays in the field, and clicking it keeps the menu open", async () => {
    const t = await setup();
    await t.menu.open();
    item(t, /^Ny lista/).click();
    await t.fixture.whenStable();

    // keys that reach the panel feed Material's typeahead, which would jump to Helg and take focus
    const reached: string[] = [];
    document
      .querySelector(".mat-mdc-menu-panel")!
      .addEventListener("keydown", (e) =>
        reached.push((e as KeyboardEvent).key),
      );
    for (const key of ["h", "ArrowDown", "Escape", "Tab"]) {
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    }
    await t.fixture.whenStable();
    expect(reached).toEqual(["Escape", "Tab"]);
    expect(document.activeElement).toBe(input());

    input().click();
    await t.fixture.whenStable();
    expect(await t.menu.isOpen()).toBe(true);
    expect(document.activeElement).toBe(input());
  });

  it("an empty name is refused under the field", async () => {
    const t = await setup();
    await t.menu.open();
    item(t, /^Ny lista/).click();
    await t.fixture.whenStable();
    const { field } = await typeName(t, "   ");
    await enter(t);
    expect(await field.getTextErrors()).toEqual(["Ange ett namn"]);
    expect(await t.menu.isOpen()).toBe(true);
    expect(t.current.lists()).toHaveLength(2);
  });

  it("right-clicking a list offers Rename and Delete, and does not switch to it", async () => {
    const t = await setup();
    await t.menu.open();
    const helg = item(t, /^Helg/);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    helg.dispatchEvent(event);
    await t.fixture.whenStable();
    expect(event.defaultPrevented).toBe(true);
    expect(t.current.list()?.name).toBe("Inköpslista");
    expect(await t.menu.isOpen()).toBe(true);
    expect(items(t).map((i) => text(i))).toEqual([
      "Byt namn på listan",
      "Ta bort listan",
    ]);
    expect(text(document.querySelector(".mat-mdc-menu-panel .heading"))).toBe(
      "Helg",
    );
  });

  it("Rename turns the name into a field; Enter saves it with undo", async () => {
    const t = await setup();
    await t.menu.open();
    item(t, /^Helg/).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await t.fixture.whenStable();
    item(t, /^Byt namn/).click();
    await t.fixture.whenStable();
    expect(input().value).toBe("Helg");
    expect(document.activeElement).toBe(input());

    await typeName(t, "Fest");
    await enter(t);
    expect(await t.menu.isOpen()).toBe(false);
    expect(t.current.lists().map((l) => l.name)).toEqual([
      "Fest",
      "Inköpslista",
    ]);
    const snackBar = await t.loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe("Listan omdöpt");
    await snackBar.dismissWithAction();
    await t.fixture.whenStable();
    expect(t.current.lists().map((l) => l.name)).toEqual([
      "Helg",
      "Inköpslista",
    ]);
  });

  it("Delete is disabled for the last list", async () => {
    const t = await setup(false);
    await t.menu.open();
    item(t, /^Inköpslista/).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await t.fixture.whenStable();
    expect(item(t, /^Ta bort/).hasAttribute("disabled")).toBe(true);
    expect(item(t, /^Byt namn/).hasAttribute("disabled")).toBe(false);
  });

  it("deleting the current list shows another, and undo brings it back", async () => {
    const t = await setup();
    await t.store.addByName(t.listId, "Mjölk");
    await t.menu.open();
    item(t, /^Inköpslista/).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await t.fixture.whenStable();
    item(t, /^Ta bort/).click();
    await t.fixture.whenStable();
    expect(text(t.el.querySelector("button"))).toBe("Helg");

    const snackBar = await t.loader.getHarness(MatSnackBarHarness);
    expect(await snackBar.getMessage()).toBe("Listan borttagen");
    await snackBar.dismissWithAction();
    await t.fixture.whenStable();
    expect(text(t.el.querySelector("button"))).toBe("Inköpslista");
  });
});
