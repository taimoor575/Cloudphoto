
import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  DynamoDBClient,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";

const cognito = new CognitoIdentityProviderClient({});
const dynamodb = new DynamoDBClient({});

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "https://main.d170st01q5amg2.amplifyapp.com",
};

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

function isAdmin(claims: Record<string, any>) {
  const groupClaim = claims["cognito:groups"];

  const groups =
    typeof groupClaim === "string"
      ? groupClaim.split(",").map((group) => group.trim())
      : Array.isArray(groupClaim)
        ? groupClaim
        : [];

  return groups.includes("Admins");
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const claims = event.requestContext.authorizer?.claims;
    const userId = claims?.sub;

    if (!userId) {
      return response(401, { message: "Authentication required." });
    }

    const path = event.path;

    // Signed-in user's profile.
    if (path.endsWith("/profile")) {
      return response(200, {
        message: "CloudSnap REST API is working!",
        user: userId,
      });
    }

    // All remaining endpoints require Admins membership.
    if (!isAdmin(claims)) {
      return response(403, {
        message: "Administrator access required.",
      });
    }

    // List registered Cognito users.
    if (path.endsWith("/admin/users")) {
      const userPoolId = process.env.USER_POOL_ID;

      if (!claims ||!userPoolId) {
        console.error("USER_POOL_ID is missing.");
        return response(500, { message: "Server configuration error." });
      }

      const requestedLimit = Number(
        event.queryStringParameters?.limit ?? "20",
      );

      const limit = Number.isFinite(requestedLimit)
        ? Math.min(60, Math.max(1, Math.floor(requestedLimit)))
        : 20;

      const result = await cognito.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          Limit: limit,
          PaginationToken:
            event.queryStringParameters?.nextToken || undefined,
        }),
      );

      const users = (result.Users ?? []).map((user) => {
        const attributes = Object.fromEntries(
          (user.Attributes ?? []).map((attribute) => [
            attribute.Name,
            attribute.Value,
          ]),
        );

        return {
          id: attributes.sub ?? user.Username,
          email: attributes.email ?? "",
          name: attributes.name ?? "",
          status: user.UserStatus ?? "UNKNOWN",
          enabled: user.Enabled ?? false,
          createdAt: user.UserCreateDate?.toISOString() ?? null,
        };
      });

      return response(200, {
        users,
        nextToken: result.PaginationToken ?? null,
      });
    }

    // Count all photo records in DynamoDB.
    if (path.endsWith("/admin/stats")) {
      const tableName = process.env.PHOTO_TABLE_NAME;

      if (!tableName) {
        console.error("PHOTO_TABLE_NAME is missing.");
        return response(500, { message: "Server configuration error." });
      }

      let totalPhotos = 0;
      let lastEvaluatedKey:
        | Record<string, import("@aws-sdk/client-dynamodb").AttributeValue>
        | undefined;

      do {
        const result = await dynamodb.send(
          new ScanCommand({
            TableName: tableName,
            Select: "COUNT",
            ExclusiveStartKey: lastEvaluatedKey,
          }),
        );

        totalPhotos += result.Count ?? 0;
        lastEvaluatedKey = result.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return response(200, {
        totalPhotos,
        generatedAt: new Date().toISOString(),
      });
    }

    return response(404, { message: "Endpoint not found." });
  } catch (error) {
    console.error("REST API error:", error);
    return response(500, { message: "Internal server error." });
  }
};
