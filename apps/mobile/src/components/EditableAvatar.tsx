import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { AvatarUploadResponse } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * The tap-to-change profile photo used by BOTH profile screens (family and
 * staff) — photo-or-initials with a small ✎ badge, opening the system photo
 * picker and posting multipart to `POST /me/photo` via `api.upload`. The
 * caller owns the profile state and receives the new URL via `onUploaded`
 * (optimistic swap; the server is the source of truth on next fetch).
 *
 * Keeps the pre-existing `profile-photo` / `profile-initials` testIDs so the
 * render-path tests on both screens hold without modification. A cancelled
 * picker is a no-op; upload failures surface inline (small red caption),
 * never as a blocking alert.
 */
export function EditableAvatar({
  photoUrl,
  initials,
  onUploaded,
  size = 64,
}: {
  photoUrl: string | null;
  initials: string;
  onUploaded: (url: string) => void;
  /**
   * Diameter in px. Defaults to the 64px disc every caller shipped with; the
   * family profile's `.bigav` asks for 82 (the pitch sets the profile head
   * bigger than an in-row avatar, because there it IS the page). Optional on
   * purpose — no existing caller changes.
   */
  size?: number;
}) {
  const tokens = useTokens();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick() {
    if (busy) return;
    setErr(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (res.canceled || !res.assets || res.assets.length === 0) return;
    const asset = res.assets[0];
    setBusy(true);
    try {
      const form = new FormData();
      // RN FormData file part: { uri, name, type } — fetch streams it as
      // multipart; api.upload leaves Content-Type to fetch for the boundary.
      form.append('file', {
        uri: asset.uri,
        name: asset.fileName ?? 'photo.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
      const out = await api.upload<AvatarUploadResponse>('/me/photo', form);
      onUploaded(out.photoUrl);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not upload the photo — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Pressable
        testID="avatar-edit"
        accessibilityRole="button"
        accessibilityLabel={photoUrl ? 'Change profile photo' : 'Add profile photo'}
        onPress={() => void pick()}
        style={{ width: size, height: size }}
      >
        {photoUrl ? (
          <Image
            testID="profile-photo"
            source={{ uri: photoUrl }}
            style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tokens.color.surfaceMuted }}
          />
        ) : (
          <View
            testID="profile-initials"
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: tokens.color.indigo50,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* The initials are set in the diary serif at the big size — at
                82px this disc is the head of the page, not a list avatar. */}
            <Text
              style={{
                fontFamily: size >= 80 ? font.serif : undefined,
                fontSize: Math.round(size * 0.32),
                fontWeight: size >= 80 ? '700' : '800',
                color: tokens.color.indigo,
              }}
            >
              {initials}
            </Text>
          </View>
        )}
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: tokens.color.indigo,
            borderWidth: 2,
            borderColor: tokens.color.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 10, color: tokens.color.onBrand }}>{busy ? '…' : '✎'}</Text>
        </View>
      </Pressable>
      {err && (
        <Text testID="avatar-error" style={{ color: tokens.color.red, fontSize: 10, marginTop: 4, maxWidth: 120 }}>
          {err}
        </Text>
      )}
    </View>
  );
}
