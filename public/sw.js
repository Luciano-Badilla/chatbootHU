self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Chatboot';
  const options = {
    body: data.body || 'Tenés una notificación nueva.',
    icon: data.icon || '/images/hu_icon_new.png',
    badge: '/favicon-32x32.png',
    tag: data.tag || 'chatboot-message',
    renotify: true,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const appIsVisible = clients.some((client) => {
      try {
        return (client.visibilityState === 'visible' || client.focused)
          && new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    return appIsVisible ? undefined : self.registration.showNotification(title, options);
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    if (existing) {
      await existing.navigate(targetUrl);
      return existing.focus();
    }

    return self.clients.openWindow(targetUrl);
  }));
});
