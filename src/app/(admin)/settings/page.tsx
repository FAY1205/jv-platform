import { redirect } from "next/navigation";

// /settings → the first section. (Profile is the landing section of the hub.)
export default function SettingsIndexPage() {
  redirect("/settings/profile");
}
