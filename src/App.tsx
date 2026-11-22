
import { useCallback, useEffect, useState } from 'react';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

import { fetchAuthSession } from 'aws-amplify/auth';
import { uploadData, getUrl, remove } from 'aws-amplify/storage';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import amplifyOutputs from '../amplify_outputs.json';

const client = generateClient<Schema>();

const apiEndpoint = (
  amplifyOutputs as {
    custom?: {
      API?: {
        CloudSnapRestApi?: {
          endpoint?: string;
        };
      };
    };
  }
).custom?.API?.CloudSnapRestApi?.endpoint;

interface PhotoItem {
  id: string;
  name: string;
  imageKey: string;
  description: string;
  url: string;
}

interface AdminUser {
  id: string;
  email?: string;
  name?: string;
  status?: string;
  enabled?: boolean;
  createdAt?: string;
}

function App() {
  return (
    <Authenticator socialProviders={['google']}>
      {({ signOut, user }) => (
        <PhotoApp user={user} signOut={signOut} />
      )}
    </Authenticator>
  );
}

function PhotoApp({ user, signOut }: any) {
  const [file, setFile] = useState<File | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [totalPhotos, setTotalPhotos] = useState<number | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');

  // Initialize Cognito session and permissions.
  useEffect(() => {
    async function initializeSession() {
      try {
        const session = await fetchAuthSession();

        if (session.identityId) {
          setFolder(`photos/${session.identityId}/`);
        } else {
          setMessage(
            'No Cognito Identity Pool ID found. Check your Amplify authentication configuration.'
          );
        }

        const groups = session.tokens?.accessToken.payload[
          'cognito:groups'
        ] as string[] | undefined;

        setIsAdmin(groups?.includes('Admins') ?? false);
      } catch (error) {
        console.error('Session initialization failed:', error);
        setMessage('Could not initialize your account session.');
      }
    }

    void initializeSession();
  }, []);

  // Load the signed-in user's photos.
  const loadPhotos = useCallback(async () => {
    try {
      const result = await client.models.Photo.list();

      if (result.errors?.length) {
        throw new Error(
          result.errors.map((error) => error.message).join(', ')
        );
      }

      const items = await Promise.all(
        result.data.map(async (record) => {
          const image = await getUrl({
            path: record.imageKey,
          });

          return {
            id: record.id,
            name: record.name,
            imageKey: record.imageKey,
            description: record.description ?? '',
            url: image.url.toString(),
          };
        })
      );

      setPhotos(items);
    } catch (error) {
      console.error('Gallery loading error:', error);
      setMessage('Could not load photos. Check the browser console.');
    }
  }, []);

  useEffect(() => {
    if (folder) {
      void loadPhotos();
    }
  }, [folder, loadPhotos]);

  // Load Admin data from the protected REST API.
  const loadAdminData = useCallback(async () => {
    if (!isAdmin) return;

    setAdminLoading(true);
    setAdminError('');

    try {
      if (!apiEndpoint) {
        throw new Error(
          'CloudSnap REST API endpoint was not found in amplify_outputs.json.'
        );
      }

      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();

      if (!token) {
        throw new Error('Could not retrieve your Cognito ID token.');
      }

      const headers = {
        Authorization: token,
        'Content-Type': 'application/json',
      };

      const baseUrl = apiEndpoint.replace(/\/$/, '');

      const [usersResponse, statsResponse] = await Promise.all([
        fetch(`${baseUrl}/admin/users`, { headers }),
        fetch(`${baseUrl}/admin/stats`, { headers }),
      ]);

      if (!usersResponse.ok) {
        throw new Error(
          `Users API returned HTTP ${usersResponse.status}: ${await usersResponse.text()}`
        );
      }

      if (!statsResponse.ok) {
        throw new Error(
          `Stats API returned HTTP ${statsResponse.status}: ${await statsResponse.text()}`
        );
      }

      const usersData = await usersResponse.json();
      const statsData = await statsResponse.json();

      const users = Array.isArray(usersData)
        ? usersData
        : usersData.users ?? usersData.data ?? [];

      setAdminUsers(users);
      setTotalPhotos(
        typeof statsData.totalPhotos === 'number'
          ? statsData.totalPhotos
          : null
      );
    } catch (error) {
      console.error('Admin API error:', error);

      setAdminError(
        error instanceof Error
          ? error.message
          : 'Could not load Admin dashboard data.'
      );
    } finally {
      setAdminLoading(false);
    }
  }, [isAdmin]);

  // Load Admin data after confirming the user's Admin group.
  useEffect(() => {
    if (isAdmin) {
      void loadAdminData();
    }
  }, [isAdmin, loadAdminData]);

  // Upload a photo.
  async function handleUpload() {
    if (!file) {
      setMessage('Please select a photo first.');
      return;
    }

    if (!folder) {
      setMessage('Please wait for your account to initialize.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const path = `${folder}${Date.now()}-${file.name}`;

      await uploadData({
        path,
        data: file,
        options: {
          contentType: file.type,
        },
      }).result;

      const result = await client.models.Photo.create({
        name: file.name,
        imageKey: path,
        description: '',
      });

      if (result.errors?.length) {
        throw new Error(
          result.errors.map((error) => error.message).join(', ')
        );
      }

      setFile(null);
      setMessage('Photo uploaded successfully!');

      await loadPhotos();

      if (isAdmin) {
        await loadAdminData();
      }
    } catch (error) {
      console.error('Upload error:', error);
      setMessage('Upload failed. Check the browser console.');
    } finally {
      setLoading(false);
    }
  }

  // Save a photo description.
  async function saveDescription(photo: PhotoItem) {
    try {
      const result = await client.models.Photo.update({
        id: photo.id,
        description: photo.description,
      });

      if (result.errors?.length) {
        throw new Error(
          result.errors.map((error) => error.message).join(', ')
        );
      }

      setMessage('Description saved successfully!');
    } catch (error) {
      console.error('Description error:', error);
      setMessage('Could not save the description.');
    }
  }

  // Delete a photo.
  async function deletePhoto(photo: PhotoItem) {
    if (!window.confirm(`Delete ${photo.name}?`)) {
      return;
    }

    try {
      setMessage('Deleting photo...');

      await remove({
        path: photo.imageKey,
      });

      const result = await client.models.Photo.delete({
        id: photo.id,
      });

      if (result.errors?.length) {
        throw new Error(
          result.errors.map((error) => error.message).join(', ')
        );
      }

      setMessage('Photo deleted successfully!');

      await loadPhotos();

      if (isAdmin) {
        await loadAdminData();
      }
    } catch (error) {
      console.error('Delete error:', error);
      setMessage('Could not delete the photo.');
    }
  }

  // Update a photo description in the UI.
  function updateDescription(id: string, description: string) {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === id
          ? { ...photo, description }
          : photo
      )
    );
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f4f6fb',
        padding: 30,
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: 'auto',
          background: 'white',
          padding: 30,
          borderRadius: 16,
        }}
      >
        <h1>CloudSnap 📸</h1>
        <h2>Welcome to your photo cloud!</h2>

        <p>
          Signed in as:{' '}
          {user.signInDetails?.loginId || user.username}
        </p>

        {isAdmin && (
          <section
            style={{
              padding: 20,
              background: '#e0ecff',
              borderRadius: 12,
              marginBottom: 25,
            }}
          >
            <h2>🛡️ Admin Dashboard</h2>
            <p>Administrator access confirmed.</p>

            <div
              style={{
                display: 'flex',
                gap: 30,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <h3>
                  {totalPhotos === null ? '—' : totalPhotos}
                </h3>
                <p>Total photos in CloudSnap</p>
              </div>

              <div>
                <h3>{adminUsers.length}</h3>
                <p>Registered users</p>
              </div>

              <div>
                <h3>Admin</h3>
                <p>Account role</p>
              </div>
            </div>

            <button
              onClick={() => void loadAdminData()}
              disabled={adminLoading}
              style={{
                padding: 10,
                background: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: 7,
                cursor: 'pointer',
              }}
            >
              {adminLoading ? 'Refreshing...' : 'Refresh Admin Data'}
            </button>

            {adminError && (
              <p style={{ color: '#b91c1c' }}>
                Admin API error: {adminError}
              </p>
            )}

            <hr />

            <h3>Registered Users</h3>

            {adminLoading && <p>Loading Admin data...</p>}

            {!adminLoading && adminUsers.length === 0 && !adminError && (
              <p>No registered users were returned.</p>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                }}
              >
                <thead>
                  <tr>
                    <th style={{ padding: 10, borderBottom: '1px solid #ccc' }}>Email</th>
                    <th style={{ padding: 10, borderBottom: '1px solid #ccc' }}>Name</th>
                    <th style={{ padding: 10, borderBottom: '1px solid #ccc' }}>Status</th>
                    <th style={{ padding: 10, borderBottom: '1px solid #ccc' }}>Enabled</th>
                  </tr>
                </thead>

                <tbody>
                  {adminUsers.map((adminUser) => (
                    <tr key={adminUser.id}>
                      <td style={{ padding: 10, borderBottom: '1px solid #eee' }}>
                        {adminUser.email || '—'}
                      </td>
                      <td style={{ padding: 10, borderBottom: '1px solid #eee' }}>
                        {adminUser.name || '—'}
                      </td>
                      <td style={{ padding: 10, borderBottom: '1px solid #eee' }}>
                        {adminUser.status || '—'}
                      </td>
                      <td style={{ padding: 10, borderBottom: '1px solid #eee' }}>
                        {adminUser.enabled === undefined
                          ? '—'
                          : adminUser.enabled ? 'Yes' : 'No'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <hr />

        <h2>Upload a photo</h2>

        <input
          type="file"
          accept="image/*"
          onChange={(event) =>
            setFile(event.target.files?.[0] || null)
          }
        />

        <button
          onClick={handleUpload}
          disabled={loading || !folder}
          style={{
            marginLeft: 10,
            padding: 12,
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {loading ? 'Uploading...' : 'Upload Photo'}
        </button>

        <p>{message}</p>

        <hr />

        <h2>My Photo Gallery</h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 20,
          }}
        >
          {photos.map((photo) => (
            <div
              key={photo.id}
              style={{
                border: '1px solid #ddd',
                borderRadius: 12,
                padding: 12,
              }}
            >
              <img
                src={photo.url}
                alt={photo.name}
                style={{
                  width: '100%',
                  height: 180,
                  objectFit: 'cover',
                  borderRadius: 8,
                }}
              />

              <h3 style={{ overflowWrap: 'anywhere' }}>
                {photo.name}
              </h3>

              <textarea
                value={photo.description}
                placeholder="Write a description..."
                onChange={(event) =>
                  updateDescription(photo.id, event.target.value)
                }
                rows={3}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: 8,
                  borderRadius: 6,
                  border: '1px solid #ccc',
                }}
              />

              <button
                onClick={() => saveDescription(photo)}
                style={{
                  marginTop: 8,
                  padding: 9,
                  background: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Save Description
              </button>

              <button
                onClick={() => deletePhoto(photo)}
                style={{
                  marginTop: 8,
                  marginLeft: 8,
                  padding: 9,
                  background: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Delete Photo
              </button>
            </div>
          ))}
        </div>

        {photos.length === 0 && (
          <p>No photos uploaded yet.</p>
        )}

        <button
          onClick={signOut}
          style={{
            marginTop: 30,
            padding: 12,
            cursor: 'pointer',
          }}
        >
          Sign Out
        </button>
      </div>
    </main>
  );
}

export default App;
