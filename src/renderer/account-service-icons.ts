import type { AccountService } from "./account-edit";

export const ACCOUNT_SERVICE_ICONS = {
  realdebrid: "./provider-icons/real-debrid.png",
  "megadebrid-api": "./provider-icons/mega-debrid.png",
  "megadebrid-web": "./provider-icons/mega-debrid.png",
  bestdebrid: "./provider-icons/bestdebrid.ico",
  alldebrid: "./provider-icons/alldebrid.png",
  ddownload: "./provider-icons/ddownload.ico",
  onefichier: "./provider-icons/onefichier.png",
  debridlink: "./provider-icons/debrid-link.ico",
  linksnappy: "./provider-icons/linksnappy.png"
} satisfies Record<AccountService, string>;
