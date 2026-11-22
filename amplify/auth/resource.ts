
import { defineAuth, secret } from '@aws-amplify/backend';
import { postConfirmation } from './post-confirmation/resource';

export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      google: {
        clientId: secret('GOOGLE_CLIENT_ID'),
        clientSecret: secret('GOOGLE_CLIENT_SECRET'),
      },
      callbackUrls: [
        'http://localhost:5173/',
        'https://main.d170st01q5amg2.amplifyapp.com/',
      ],
      logoutUrls: [
        'http://localhost:5173/',
        'https://main.d170st01q5amg2.amplifyapp.com/',
      ],
    },
  },

  groups: ['Users', 'Admins'],

  triggers: {
    postConfirmation,
  },

  access: (allow) => [
    allow.resource(postConfirmation).to(['addUserToGroup']),
  ],
});
