
import { defineFunction } from '@aws-amplify/backend';

export const restApiFunction = defineFunction({
  name: 'cloudsnap-rest-api',
  resourceGroupName: 'data',
});
