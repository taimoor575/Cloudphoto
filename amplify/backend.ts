
import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';

import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';

import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnFunction } from 'aws-cdk-lib/aws-lambda';

import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { restApiFunction } from './functions/rest-api/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  restApiFunction,
});

// --------------------------------------------------
// Owner-scoped S3 permissions for Cognito group roles
// --------------------------------------------------

// Exact bucket currently deployed in your AWS account.
const photoBucketArn =
  'arn:aws:s3:::amplify-cloudphoto-lenovo-cloudsnapphotosbucket994-4kx8qsak3pm8';

// Allow access only to the current Cognito identity's folder.
const photoObjectPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    's3:GetObject',
    's3:PutObject',
    's3:DeleteObject',
  ],
  resources: [
    `${photoBucketArn}/photos/\${cognito-identity.amazonaws.com:sub}/*`,
  ],
});

const photoListPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['s3:ListBucket'],
  resources: [photoBucketArn],
  conditions: {
    StringLike: {
      's3:prefix': [
        'photos/${cognito-identity.amazonaws.com:sub}/*',
        'photos/${cognito-identity.amazonaws.com:sub}/',
      ],
    },
  },
});

// Both groups use separate IAM roles.
for (const groupName of ['Users', 'Admins'] as const) {
  const groupRole = backend.auth.resources.groups[groupName].role;

  groupRole.addToPrincipalPolicy(photoObjectPolicy);
  groupRole.addToPrincipalPolicy(photoListPolicy);
}

// --------------------------------------------------
// REST API stack
// --------------------------------------------------

const apiStack = backend.createStack('CloudSnapRestApiStack');

const restApi = new RestApi(apiStack, 'CloudSnapRestApi', {
  restApiName: 'CloudSnap REST API',
  deployOptions: {
    stageName: 'dev',
  },
  defaultCorsPreflightOptions: {
   allowOrigins: [
  'http://localhost:5173',
  'https://main.d170st01q5amg2.amplifyapp.com',
],
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: ['Authorization', 'Content-Type'],
  },
});

// REST API Lambda
const restApiLambda = backend.restApiFunction.resources.lambda;
const lambdaCfn = restApiLambda.node.defaultChild as CfnFunction;

// Lambda environment variables
lambdaCfn.addPropertyOverride(
  'Environment.Variables.USER_POOL_ID',
  backend.auth.resources.userPool.userPoolId
);

const photoTable = backend.data.resources.tables['Photo'];

lambdaCfn.addPropertyOverride(
  'Environment.Variables.PHOTO_TABLE_NAME',
  photoTable.tableName
);

// Cognito ListUsers permission
restApiLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['cognito-idp:ListUsers'],
    resources: [
      backend.auth.resources.userPool.userPoolArn,
    ],
  })
);

// DynamoDB read permission
photoTable.grantReadData(restApiLambda);

// Cognito API authorizer
const lambdaIntegration = new LambdaIntegration(restApiLambda);

const cognitoAuthorizer = new CognitoUserPoolsAuthorizer(
  apiStack,
  'CloudSnapCognitoAuthorizer',
  {
    cognitoUserPools: [
      backend.auth.resources.userPool,
    ],
  }
);

// GET /profile
const profilePath = restApi.root.addResource('profile');

profilePath.addMethod('GET', lambdaIntegration, {
  authorizationType: AuthorizationType.COGNITO,
  authorizer: cognitoAuthorizer,
});

// GET /admin/users
const adminPath = restApi.root.addResource('admin');
const adminUsersPath = adminPath.addResource('users');

adminUsersPath.addMethod('GET', lambdaIntegration, {
  authorizationType: AuthorizationType.COGNITO,
  authorizer: cognitoAuthorizer,
});

// GET /admin/stats
const adminStatsPath = adminPath.addResource('stats');

adminStatsPath.addMethod('GET', lambdaIntegration, {
  authorizationType: AuthorizationType.COGNITO,
  authorizer: cognitoAuthorizer,
});

// Amplify outputs
backend.addOutput({
  custom: {
    API: {
      CloudSnapRestApi: {
        endpoint: restApi.url,
        region: Stack.of(restApi).region,
        apiName: restApi.restApiName,
      },
    },
  },
});
