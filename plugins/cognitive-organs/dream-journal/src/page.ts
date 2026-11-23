import type { ConsolePageModule } from "@ai0/sdk";

export const mountPage: ConsolePageModule<HTMLElement>["mountPage"] = (container, host) => {
  const section = document.createElement("section");
  section.className = "ai0-workspace-page";
  const heading = document.createElement("h1");
  heading.textContent = "梦境手记";
  const entries = document.createElement("div");
  section.append(heading, entries);
  container.append(section);
  function render() {
    const journal = host.getState().journal ?? [];
    entries.replaceChildren();
    if (!journal.length) entries.textContent = "当前存档暂无梦境手记。";
    for (const item of journal) {
      const article = document.createElement("article");
      const title = document.createElement("h2");
      title.textContent = item.title;
      const date = document.createElement("small");
      date.textContent = item.date;
      const content = document.createElement("p");
      content.textContent = item.content;
      article.append(title, date, content);
      entries.append(article);
    }
  }
  render();
  const unsubscribe = host.subscribe(render);
  return () => { unsubscribe(); section.remove(); };
};
