'use client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';
import { SOCIAL_PLATFORMS } from './types';
import { Select } from '@/components/ui/select';
import type { SiteForm } from './site-form';

export default function ContactTab({ form }: { form: SiteForm }) {
  const {
    phone,
    setPhone,
    contactEmail,
    setContactEmail,
    addressLine1,
    setAddressLine1,
    addressLine2,
    setAddressLine2,
    city,
    setCity,
    region,
    setRegion,
    postalCode,
    setPostalCode,
    country,
    setCountry,
    mapEmbedUrl,
    setMapEmbedUrl,
    socialLinks,
    addSocialLink,
    removeSocialLink,
    updateSocialLink,
    contactMutation,
  } = form;

  return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Contact &amp; address</CardTitle>
        </CardHeader>
        {/* Two columns on wide screens: reachability on the left, the map and
            social presence on the right. */}
        <CardContent>
          <div className="grid gap-x-10 gap-y-5 lg:grid-cols-2">
          <div className="space-y-5">
          {/* Phone + email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 000 0000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="info@school.com"
              />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label htmlFor="addr1">Address line 1</Label>
            <Input
              id="addr1"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="42 Garden Avenue"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="addr2">Address line 2</Label>
            <Input
              id="addr2"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              placeholder="Suite 100 (optional)"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Bengaluru"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="region">State / Region</Label>
              <Input
                id="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="Karnataka"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="postal-code">Postal code</Label>
              <Input
                id="postal-code"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="560001"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="India"
              />
            </div>
          </div>
          </div>

          <div className="space-y-5">
          <div className="space-y-2">
            <Label
              htmlFor="map-embed"
              hint="In Google Maps: Share → Embed a map → copy the src=&quot;…&quot; URL. A plain share link (maps.app.goo.gl) won't work in an iframe — but if you leave this blank, the map falls back to your address above."
            >
              Map embed URL (optional)
            </Label>
            <Input
              id="map-embed"
              value={mapEmbedUrl}
              onChange={(e) => setMapEmbedUrl(e.target.value)}
              placeholder="https://www.google.com/maps/embed?pb=…"
            />
          </div>

          {/* Social links editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Social links</Label>
              <Button variant="outline" size="sm" onClick={addSocialLink}>
                <Plus className="h-4 w-4" />
                Add link
              </Button>
            </div>
            {socialLinks.length === 0 && (
              <p className="text-sm text-slate-400">No social links yet. Add one above.</p>
            )}
            {socialLinks.map((link, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={link.platform}
                  onChange={(e) => updateSocialLink(idx, 'platform', e.target.value)}
                  className="w-36 shrink-0"
                >
                  {SOCIAL_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0) + p.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
                <Input
                  value={link.url}
                  onChange={(e) => updateSocialLink(idx, 'url', e.target.value)}
                  placeholder="https://…"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSocialLink(idx)}
                  className="shrink-0 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={() => contactMutation.mutate()}
            disabled={contactMutation.isPending}
          >
            {contactMutation.isPending ? 'Saving…' : 'Save contact info'}
          </Button>
        </CardFooter>
      </Card>
  );
}
