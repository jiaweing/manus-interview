import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Card, useThemeColor } from "heroui-native";
import { Alert, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { SignIn } from "@/components/sign-in";
import { SignUp } from "@/components/sign-up";
import { authClient } from "@/lib/auth-client";

import { ENV } from "../../src/env";

export default function Home() {
	const { data: session } = authClient.useSession();

	const openPolarLink = async (url: string, returnUrl: string) => {
		await WebBrowser.openAuthSessionAsync(url, returnUrl);
	};

	const getPolarReturnUrl = (returnUrl: string) => {
		const url = new URL("/polar/success", ENV.EXPO_PUBLIC_SERVER_URL);
		url.searchParams.set("returnUrl", returnUrl);
		return url.toString();
	};

	const handlePolarCheckout = async () => {
		const returnUrl = Linking.createURL("/");
		const polarReturnUrl = getPolarReturnUrl(returnUrl);
		const { data, error } = await authClient.checkout({
			redirect: false,
			return_url: polarReturnUrl,
			slug: "pro",
			success_url: polarReturnUrl,
		});

		if (error || !data?.url) {
			Alert.alert(
				"Checkout unavailable",
				error?.message ?? "Unable to create a checkout session."
			);
			return;
		}

		await openPolarLink(data.url, returnUrl);
	};

	const handlePolarPortal = async () => {
		const returnUrl = Linking.createURL("/");
		const { data, error } = await authClient.customer.portal({
			redirect: false,
		});

		if (error || !data?.url) {
			Alert.alert(
				"Portal unavailable",
				error?.message ?? "Unable to open the customer portal."
			);
			return;
		}

		await openPolarLink(data.url, returnUrl);
	};

	const mutedColor = useThemeColor("muted");
	const successColor = useThemeColor("success");
	const dangerColor = useThemeColor("danger");
	const foregroundColor = useThemeColor("foreground");

	return (
		<Container className="p-6">
			<View className="mb-6 py-4">
				<Text className="mb-2 font-bold text-4xl text-foreground">
					BETTER T STACK
				</Text>
			</View>

			{session?.user ? (
				<Card className="mb-6 p-4" variant="secondary">
					<Text className="mb-2 text-base text-foreground">
						Welcome, <Text className="font-medium">{session.user.name}</Text>
					</Text>
					<Text className="mb-4 text-muted text-sm">{session.user.email}</Text>
					<Pressable
						className="self-start rounded-lg bg-danger px-4 py-3 active:opacity-70"
						onPress={() => {
							authClient.signOut();
						}}
					>
						<Text className="font-medium text-foreground">Sign Out</Text>
					</Pressable>
					<View className="mt-4 gap-3">
						<Pressable
							className="self-start rounded-lg bg-primary px-4 py-3 active:opacity-70"
							onPress={handlePolarCheckout}
						>
							<Text className="font-medium text-foreground">
								Upgrade to Pro
							</Text>
						</Pressable>
						<Pressable
							className="self-start rounded-lg border border-border px-4 py-3 active:opacity-70"
							onPress={handlePolarPortal}
						>
							<Text className="font-medium text-foreground">
								Manage Subscription
							</Text>
						</Pressable>
					</View>
				</Card>
			) : null}

			{!session?.user && (
				<>
					<SignIn />
					<SignUp />
				</>
			)}
		</Container>
	);
}
