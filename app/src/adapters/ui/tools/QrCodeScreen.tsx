import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { CalendarClock, Contact, Download, Link2, Mail, MapPin, MessageSquare, Phone, Wifi } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { QrPayloadBuilder, type QrPayloadInput, type WifiSecurityType } from '@/core/office_media/qrPayloadBuilder'

const builder = new QrPayloadBuilder()

type Mode = 'text' | 'wifi' | 'phone' | 'sms' | 'email' | 'vcard' | 'geo' | 'event'

const MODES: { id: Mode; label: string; icon: typeof Link2 }[] = [
  { id: 'text', label: 'Text / URL', icon: Link2 },
  { id: 'wifi', label: 'Wi-Fi', icon: Wifi },
  { id: 'phone', label: 'Phone', icon: Phone },
  { id: 'sms', label: 'SMS', icon: MessageSquare },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'vcard', label: 'Contact', icon: Contact },
  { id: 'geo', label: 'Location', icon: MapPin },
  { id: 'event', label: 'Event', icon: CalendarClock },
]

const SWATCH_PALETTE = ['#000000', '#FFFFFF', '#4F46E5', '#DC2626', '#16A34A', '#2563EB', '#EA580C']

function defaultEventStart(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0)
}

/** Formats a `Date` for an `<input type="datetime-local">` value, in local time. */
function toDatetimeLocalValue(date: Date): string {
  const pad = (v: number) => v.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const defaultEventStartValue = defaultEventStart()
const defaultEventEndValue = new Date(defaultEventStartValue.getTime() + 60 * 60 * 1000)

export function QrCodeScreen() {
  const [mode, setMode] = useState<Mode>('text')

  // Text / URL
  const [text, setText] = useState('https://example.com')

  // Wi-Fi
  const [ssid, setSsid] = useState('')
  const [wifiPassword, setWifiPassword] = useState('')
  const [security, setSecurity] = useState<WifiSecurityType>('wpa')
  const [hidden, setHidden] = useState(false)

  // Phone
  const [phone, setPhone] = useState('')

  // SMS
  const [smsNumber, setSmsNumber] = useState('')
  const [smsMessage, setSmsMessage] = useState('')

  // Email
  const [emailAddress, setEmailAddress] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')

  // vCard
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [organization, setOrganization] = useState('')
  const [title, setTitle] = useState('')
  const [cardPhone, setCardPhone] = useState('')
  const [cardEmail, setCardEmail] = useState('')
  const [cardUrl, setCardUrl] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [country, setCountry] = useState('')

  // Geo
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [alt, setAlt] = useState('')

  // Calendar event
  const [eventSummary, setEventSummary] = useState('')
  const [eventLocation, setEventLocation] = useState('')
  const [eventDescription, setEventDescription] = useState('')
  const [eventStart, setEventStart] = useState(toDatetimeLocalValue(defaultEventStartValue))
  const [eventEnd, setEventEnd] = useState(toDatetimeLocalValue(defaultEventEndValue))

  // Appearance
  const [foreground, setForeground] = useState('#000000')
  const [background, setBackground] = useState('#FFFFFF')
  const [size, setSize] = useState(220)

  const computed = useMemo((): { payload: string | null; error: string | null } => {
    try {
      const input = buildInput()
      if (input == null) return { payload: null, error: null }
      const payload = builder.execute(input)
      return payload.length === 0 ? { payload: null, error: null } : { payload, error: null }
    } catch (e) {
      return { payload: null, error: e instanceof Error ? e.message : String(e) }
    }

    function buildInput(): QrPayloadInput | null {
      switch (mode) {
        case 'text':
          return { kind: 'plainText', text }

        case 'wifi':
          if (ssid.length === 0) return null
          return { kind: 'wifiNetwork', ssid, password: wifiPassword, security, hidden }

        case 'phone':
          if (phone.trim().length === 0) return null
          return { kind: 'phoneNumber', number: phone }

        case 'sms':
          if (smsNumber.trim().length === 0) return null
          return { kind: 'sms', number: smsNumber, message: smsMessage }

        case 'email':
          if (emailAddress.trim().length === 0) return null
          return { kind: 'email', address: emailAddress, subject: emailSubject, body: emailBody }

        case 'vcard':
          if (firstName.trim().length === 0 && lastName.trim().length === 0) return null
          return {
            kind: 'vCard',
            firstName,
            lastName,
            organization,
            title,
            phone: cardPhone,
            email: cardEmail,
            url: cardUrl,
            street,
            city,
            region,
            postalCode,
            country,
          }

        case 'geo': {
          const latText = lat.trim()
          const lonText = lon.trim()
          if (latText.length === 0 && lonText.length === 0) return null
          const latitude = Number.parseFloat(latText)
          if (latText.length === 0 || Number.isNaN(latitude)) {
            throw new Error('Latitude must be a decimal number, e.g. 40.7187.')
          }
          const longitude = Number.parseFloat(lonText)
          if (lonText.length === 0 || Number.isNaN(longitude)) {
            throw new Error('Longitude must be a decimal number, e.g. -73.989.')
          }
          const altText = alt.trim()
          let altitudeMeters: number | undefined
          if (altText.length > 0) {
            altitudeMeters = Number.parseFloat(altText)
            if (Number.isNaN(altitudeMeters)) {
              throw new Error('Altitude must be a number of meters.')
            }
          }
          return { kind: 'geoLocation', latitude, longitude, altitudeMeters }
        }

        case 'event':
          if (eventSummary.trim().length === 0) return null
          return {
            kind: 'calendarEvent',
            summary: eventSummary,
            location: eventLocation,
            description: eventDescription,
            start: new Date(eventStart),
            end: new Date(eventEnd),
          }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    text,
    ssid,
    wifiPassword,
    security,
    hidden,
    phone,
    smsNumber,
    smsMessage,
    emailAddress,
    emailSubject,
    emailBody,
    firstName,
    lastName,
    organization,
    title,
    cardPhone,
    cardEmail,
    cardUrl,
    street,
    city,
    region,
    postalCode,
    country,
    lat,
    lon,
    alt,
    eventSummary,
    eventLocation,
    eventDescription,
    eventStart,
    eventEnd,
  ])

  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!computed.payload) {
      setDataUrl(null)
      setRenderError(null)
      return
    }
    QRCode.toDataURL(computed.payload, { width: size, margin: 2, errorCorrectionLevel: 'M', color: { dark: foreground, light: background } })
      .then((url) => {
        if (cancelled) return
        setDataUrl(url)
        setRenderError(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setDataUrl(null)
        setRenderError(
          e instanceof Error
            ? `This payload is too long to encode as a QR code (${e.message}).`
            : 'This payload could not be rendered as a QR code.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [computed.payload, foreground, background, size])

  const error = computed.error ?? renderError

  return (
    <ToolDetailScaffold
      title="QR Code Generator"
      copyText={computed.payload ?? undefined}
      inputPanel={
        <div className="flex max-w-md flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Content type</p>
            <div className="flex flex-wrap gap-2">
              {MODES.map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={mode === id ? 'default' : 'outline'}
                  onClick={() => setMode(id)}
                  className="gap-1.5"
                >
                  <Icon className="size-3.5" />
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {mode === 'text' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qr-text">Text or URL</Label>
              <Textarea
                id="qr-text"
                className="min-h-20"
                placeholder="https://example.com or any plain text"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          ) : null}

          {mode === 'wifi' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ssid">Network name (SSID)</Label>
                <Input id="ssid" placeholder="MyHomeNetwork" value={ssid} onChange={(e) => setSsid(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Security</Label>
                <RadioGroup value={security} onValueChange={(v) => setSecurity((v as WifiSecurityType) ?? 'wpa')}>
                  {(['wpa', 'wep', 'nopass'] as WifiSecurityType[]).map((s) => (
                    <div key={s} className="flex items-center gap-2">
                      <RadioGroupItem value={s} id={`security-${s}`} />
                      <Label htmlFor={`security-${s}`} className="font-normal">
                        {s === 'wpa' ? 'WPA/WPA2' : s === 'wep' ? 'WEP' : 'Open (no password)'}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              {security !== 'nopass' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wifi-password">Password</Label>
                  <Input
                    id="wifi-password"
                    placeholder="Network password"
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                  />
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="hidden-network" className="font-normal">
                  Hidden network
                </Label>
                <Switch id="hidden-network" checked={hidden} onCheckedChange={setHidden} />
              </div>
            </div>
          ) : null}

          {mode === 'phone' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone-number">Phone number</Label>
              <Input id="phone-number" placeholder="+1 212 555 1212" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <p className="text-xs text-muted-foreground">Use the international form so it dials from anywhere.</p>
            </div>
          ) : null}

          {mode === 'sms' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sms-number">Recipient number</Label>
                <Input id="sms-number" placeholder="+1 800 555 1212" value={smsNumber} onChange={(e) => setSmsNumber(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sms-message">Message</Label>
                <Textarea
                  id="sms-message"
                  placeholder="Message body (optional)"
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Line breaks are folded to spaces — SMSTO is a single line.</p>
              </div>
            </div>
          ) : null}

          {mode === 'email' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-address">To</Label>
                <Input
                  id="email-address"
                  placeholder="someone@example.com"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-subject">Subject</Label>
                <Input id="email-subject" placeholder="Optional" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-body">Body</Label>
                <Textarea id="email-body" placeholder="Optional" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
                <p className="text-xs text-muted-foreground">Spaces and & are percent-encoded automatically.</p>
              </div>
            </div>
          ) : null}

          {mode === 'vcard' ? (
            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="first-name">First name</Label>
                  <Input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="last-name">Last name</Label>
                  <Input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="organization">Organization</Label>
                  <Input id="organization" value={organization} onChange={(e) => setOrganization(e.target.value)} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="job-title">Job title</Label>
                  <Input id="job-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="card-phone">Phone</Label>
                <Input id="card-phone" placeholder="+1 212 555 1212" value={cardPhone} onChange={(e) => setCardPhone(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="card-email">Email</Label>
                <Input
                  id="card-email"
                  placeholder="someone@example.com"
                  value={cardEmail}
                  onChange={(e) => setCardEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="card-url">Website</Label>
                <Input id="card-url" placeholder="https://example.com" value={cardUrl} onChange={(e) => setCardUrl(e.target.value)} />
              </div>
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Address</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="street">Street</Label>
                  <Input id="street" value={street} onChange={(e) => setStreet(e.target.value)} />
                </div>
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="city">City</Label>
                    <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="region">State / region</Label>
                    <Input id="region" value={region} onChange={(e) => setRegion(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="postal-code">Postal code</Label>
                    <Input id="postal-code" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="country">Country</Label>
                    <Input id="country" value={country} onChange={(e) => setCountry(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {mode === 'geo' ? (
            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="latitude">Latitude</Label>
                  <Input id="latitude" placeholder="40.71872" value={lat} onChange={(e) => setLat(e.target.value)} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="longitude">Longitude</Label>
                  <Input id="longitude" placeholder="-73.98905" value={lon} onChange={(e) => setLon(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="altitude">Altitude (m)</Label>
                <Input id="altitude" placeholder="Optional" value={alt} onChange={(e) => setAlt(e.target.value)} />
                <p className="text-xs text-muted-foreground">Decimal degrees: latitude -90..90, longitude -180..180.</p>
              </div>
            </div>
          ) : null}

          {mode === 'event' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-summary">Title</Label>
                <Input id="event-summary" placeholder="Team offsite" value={eventSummary} onChange={(e) => setEventSummary(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-location">Location</Label>
                <Input id="event-location" placeholder="Optional" value={eventLocation} onChange={(e) => setEventLocation(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-description">Description</Label>
                <Textarea
                  id="event-description"
                  placeholder="Optional"
                  value={eventDescription}
                  onChange={(e) => setEventDescription(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="event-start">Starts</Label>
                  <Input id="event-start" type="datetime-local" value={eventStart} onChange={(e) => setEventStart(e.target.value)} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="event-end">Ends</Label>
                  <Input id="event-end" type="datetime-local" value={eventEnd} onChange={(e) => setEventEnd(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Encoded as UTC (...Z) so the event lands at the same instant everywhere.</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
            <p className="text-sm font-medium">Appearance</p>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Foreground</Label>
              <ColorSwatchRow value={foreground} onChange={setForeground} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Background</Label>
              <ColorSwatchRow value={background} onChange={setBackground} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Size: {size}px</Label>
              <Slider value={size} min={120} max={360} step={4} onValueChange={(v) => setSize(v as number)} />
            </div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      }
      outputPanel={
        !computed.payload ? (
          <p className="text-sm text-muted-foreground">Fill in the fields on the left to generate a QR code.</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div
              className="flex w-fit items-center justify-center rounded-xl border border-border/60 p-4"
              style={{ backgroundColor: background }}
            >
              {dataUrl ? (
                <img src={dataUrl} alt="Generated QR code" width={size} height={size} />
              ) : (
                <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ width: size, height: size }}>
                  {renderError ? 'Could not render this QR code.' : 'Rendering...'}
                </div>
              )}
            </div>
            {dataUrl ? (
              <a href={dataUrl} download="qr-code.png" className={buttonVariants({ variant: 'outline', className: 'w-fit gap-1.5' })}>
                <Download className="size-4" />
                Download PNG
              </a>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">Payload text</p>
              <pre className="max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-3 font-mono text-xs">
                {computed.payload}
              </pre>
            </div>
            <p className="text-xs text-muted-foreground">Use the copy button in the top bar to copy the payload text.</p>
          </div>
        )
      }
    />
  )
}

function ColorSwatchRow({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {SWATCH_PALETTE.map((color) => {
        const selected = color.toLowerCase() === value.toLowerCase()
        return (
          <button
            key={color}
            type="button"
            aria-label={color}
            onClick={() => onChange(color)}
            className="size-7 rounded-full transition-[box-shadow]"
            style={{
              backgroundColor: color,
              border: color.toLowerCase() === '#ffffff' ? '1px solid var(--border)' : 'none',
              boxShadow: selected ? '0 0 0 2px var(--background), 0 0 0 4px var(--primary)' : 'none',
            }}
          />
        )
      })}
    </div>
  )
}
