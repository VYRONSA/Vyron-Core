import { redirect } from "next/navigation";

/** Solution Templates now live under the Marketplace section. */
export default function PlatformTemplatesRedirectPage() {
  redirect("/platform/marketplace");
}
