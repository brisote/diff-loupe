export const pages: {
  path: string;
  title: string;
  current: string;
  board: string;
  footerBoard?: string;
  boards?: string[];
}[] = [
  {
    path: "/",
    title: "Diffloupe",
    current: "Home",
    board: "Main",
    footerBoard: "Home3",
    boards: ["Main", "Home2", "Home3"],
  },
  {
    path: "/download/",
    title: "Download",
    current: "Download",
    board: "Download",
    boards: ["Download"],
  },
  {
    path: "/changelog/",
    title: "Changelog",
    current: "Changelog",
    board: "Changelog",
    boards: ["Changelog"],
  },
  {
    path: "/privacy/",
    title: "Privacy",
    current: "Privacy",
    board: "Privacy",
    boards: ["Privacy"],
  },
];

export const missing = { path: "/no-such-page/", board: "NotFound" };
