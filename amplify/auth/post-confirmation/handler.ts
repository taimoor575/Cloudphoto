import type { PostConfirmationTriggerHandler } from "aws-lambda";

import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { env } from "$amplify/env/post-confirmation";

const client = new CognitoIdentityProviderClient({});

export const handler: PostConfirmationTriggerHandler = async (event) => {
  const command = new AdminAddUserToGroupCommand({
    GroupName: env.GROUP_NAME,
    Username: event.userName,
    UserPoolId: event.userPoolId,
  });

  await client.send(command);

  console.log(`User ${event.userName} added to Users group`);

  return event;
};
