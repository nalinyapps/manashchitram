"use client";

import { useEffect, useState } from "react";

export type DeviceKind = "phone" | "tablet" | "desktop";
export type DevicePlatform = "android" | "ios" | "macos" | "windows" | "chromeos" | "linux" | "unknown";
export type InputMode = "touch" | "mouse" | "hybrid";

export interface DeviceProfile {
  kind: DeviceKind;
  platform: DevicePlatform;
  input: InputMode;
  isTouch: boolean;
}

function platformFromUA(ua: string, platform: string, touchPoints: number): DevicePlatform {
  const haystack = `${ua} ${platform}`.toLowerCase();
  if (haystack.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(haystack)) return "ios";
  if (platform.toLowerCase() === "macintel" && touchPoints > 1) return "ios";
  if (haystack.includes("cros")) return "chromeos";
  if (haystack.includes("win")) return "windows";
  if (haystack.includes("mac")) return "macos";
  if (haystack.includes("linux")) return "linux";
  return "unknown";
}

function getProfile(): DeviceProfile {
  if (typeof window === "undefined") {
    return { kind: "desktop", platform: "unknown", input: "mouse", isTouch: false };
  }

  const width = window.innerWidth;
  const ua = navigator.userAgent;
  const platform = navigator.platform ?? "";
  const touchPoints = navigator.maxTouchPoints ?? 0;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const fine = window.matchMedia("(pointer: fine)").matches;
  const isTouch = coarse || touchPoints > 0;
  const devicePlatform = platformFromUA(ua, platform, touchPoints);
  const isMobileUA = /android|iphone|ipod|mobile/i.test(ua);
  const isTabletUA = /ipad|tablet/i.test(ua) || (devicePlatform === "ios" && touchPoints > 1 && width >= 768);

  const kind: DeviceKind = width < 700 || (isTouch && isMobileUA && width < 820)
    ? "phone"
    : width < 1100 || isTabletUA
      ? "tablet"
      : "desktop";
  const input: InputMode = isTouch && fine ? "hybrid" : isTouch ? "touch" : "mouse";

  return { kind, platform: devicePlatform, input, isTouch };
}

export function useDeviceProfile(): DeviceProfile {
  const [profile, setProfile] = useState<DeviceProfile>(() => getProfile());

  useEffect(() => {
    const update = () => setProfile(getProfile());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return profile;
}
