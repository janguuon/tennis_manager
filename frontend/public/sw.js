/*
 * 오테식 매니저 서비스 워커: 폰 알림(웹 푸시)만 다룬다.
 * 페이지·데이터를 캐시하지 않는다 (fetch 를 가로채지 않음) — 늘 서버의 최신 화면을 본다.
 *
 * 서버가 보내는 알림 내용(JSON): { title, body, url, tag }
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "오테식 매니저";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      lang: "ko",
      // 같은 tag 는 새 알림이 이전 것을 바꾼다 (같은 경기·같은 모임 알림이 쌓이지 않게)
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/app" },
    }),
  );
});

// 알림을 누르면 앱을 열어 그 화면으로 (이미 열려 있으면 그 창에서)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/app", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(url);
            return;
          } catch (e) {
            // 이 워커가 맡지 않은 창이면 navigate 가 안 된다 → 새 창
          }
        } else {
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
