import webpush from 'web-push';

const vapidKeys = webpush.generateVAPIDKeys();

console.log('PUBLIC_VAPID_KEY=');
console.log(vapidKeys.publicKey);

console.log('\nVAPID_PRIVATE_KEY=');
console.log(vapidKeys.privateKey);
