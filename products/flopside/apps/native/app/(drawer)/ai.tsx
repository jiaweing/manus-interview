import { useChat } from "@ai-sdk/react";
import { Ionicons } from "@expo/vector-icons";
import { DefaultChatTransport } from "ai";
import {
	Button,
	FieldError,
	Input,
	Separator,
	Spinner,
	Surface,
	TextField,
	useThemeColor,
} from "heroui-native";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";

import { Container } from "@/components/container";

import { ENV } from "../../src/env";

const starterPrompts = [
	{
		label: "Plan a feature",
		prompt: "Help me plan the first version of a habit tracking feature.",
	},
	{
		label: "Draft an API",
		prompt: "Sketch a clean API contract for projects, tasks, and comments.",
	},
	{
		label: "Debug an issue",
		prompt: "Walk me through debugging a slow mobile screen.",
	},
];

const generateAPIUrl = (relativePath: string) => {
	const serverUrl = ENV.EXPO_PUBLIC_SERVER_URL;
	if (!serverUrl) {
		throw new Error(
			"EXPO_PUBLIC_SERVER_URL environment variable is not defined"
		);
	}
	const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
	return serverUrl.concat(path);
};

export default function AIScreen() {
	const [input, setInput] = useState("");
	const { messages, error, sendMessage, status, setMessages } = useChat({
		onError: (error) => console.error(error, "AI Chat Error"),
		transport: new DefaultChatTransport({
			api: generateAPIUrl("/ai"),
		}),
	});
	const scrollViewRef = useRef<ComponentRef<typeof ScrollView>>(null);
	const foregroundColor = useThemeColor("foreground");
	const mutedColor = useThemeColor("muted");
	const isBusy = status === "submitted" || status === "streaming";
	const hasMessages = messages.length > 0;
	const canSend = Boolean(input.trim()) && !isBusy;

	useEffect(() => {
		scrollViewRef.current?.scrollToEnd({ animated: true });
	}, [messages, isBusy]);

	const sendPrompt = (prompt: string) => {
		const value = prompt.trim();
		if (!value || isBusy) {
			return;
		}

		sendMessage({ text: value });
		setInput("");
	};

	const onNewChat = () => {
		if (isBusy) {
			return;
		}
		setInput("");
		setMessages([]);
	};

	return (
		<Container isScrollable={false}>
			<KeyboardAvoidingView
				behavior={Platform.OS === "ios" ? "padding" : "height"}
				className="flex-1"
			>
				<View className="flex-1 px-4">
					<View className="flex-row items-center justify-between py-3">
						<View className="flex-row items-center gap-2">
							<View
								className={`h-2 w-2 rounded-full ${isBusy ? "bg-primary" : "bg-border"}`}
							/>
							<Text className="font-semibold text-foreground text-sm tabular-nums">
								{isBusy
									? status === "submitted"
										? "Sending"
										: "Streaming"
									: hasMessages
										? `${messages.length} messages`
										: "Ready"}
							</Text>
						</View>
						<Button
							isDisabled={isBusy || !hasMessages}
							onPress={onNewChat}
							size="sm"
							variant="secondary"
						>
							<Ionicons color={foregroundColor} name="add" size={16} />
							<Text className="font-medium text-foreground text-sm">New</Text>
						</Button>
					</View>

					<Separator className="mb-1" />

					<ScrollView
						className="flex-1"
						contentContainerStyle={{ flexGrow: 1, paddingVertical: 16 }}
						keyboardShouldPersistTaps="handled"
						ref={scrollViewRef}
						showsVerticalScrollIndicator={false}
					>
						{hasMessages ? (
							<View className="gap-3">
								{messages.map((message) => (
									<View
										className={`flex-row ${
											message.role === "user" ? "justify-end" : "justify-start"
										}`}
										key={message.id}
									>
										<Surface
											className={`rounded-2xl p-3 ${
												message.role === "user"
													? "rounded-tr-md"
													: "rounded-tl-md"
											}`}
											style={{ maxWidth: "86%" }}
											variant={
												message.role === "user" ? "tertiary" : "secondary"
											}
										>
											<Text className="mb-1 font-semibold text-muted text-xs">
												{message.role === "user" ? "You" : "AI"}
											</Text>
											<View className="gap-1">
												{(message.parts ?? []).map((part, i) =>
													part.type === "text" ? (
														<Text
															className="text-foreground text-sm leading-relaxed"
															key={`${message.id}-${i}`}
															selectable
														>
															{part.text}
														</Text>
													) : (
														<Text
															className="text-foreground text-sm leading-relaxed"
															key={`${message.id}-${i}`}
															selectable
														>
															{JSON.stringify(part)}
														</Text>
													)
												)}
											</View>
										</Surface>
									</View>
								))}
								{isBusy && (
									<View className="flex-row justify-start">
										<Surface
											className="rounded-2xl rounded-tl-md p-3"
											style={{ maxWidth: "86%" }}
											variant="secondary"
										>
											<Text className="mb-1 font-semibold text-muted text-xs">
												AI
											</Text>
											<View className="flex-row items-center gap-2">
												<Spinner size="sm" />
												<Text className="text-muted text-sm">Thinking...</Text>
											</View>
										</Surface>
									</View>
								)}
							</View>
						) : (
							<View className="flex-1 justify-center gap-3">
								<View className="items-center gap-3">
									<Surface
										className="h-14 w-14 items-center justify-center rounded-full"
										variant="secondary"
									>
										<Ionicons
											color={mutedColor}
											name="chatbubble-ellipses-outline"
											size={28}
										/>
									</Surface>
									<Text className="text-center font-semibold text-foreground text-xl">
										Start a conversation
									</Text>
									<Text
										className="text-center text-muted text-sm leading-5"
										selectable
									>
										Use a starter prompt or ask your own question.
									</Text>
								</View>
								<View className="gap-2">
									{starterPrompts.map((item) => (
										<Pressable
											disabled={isBusy}
											key={item.label}
											onPress={() => sendPrompt(item.prompt)}
										>
											<Surface
												className={`gap-1 rounded-xl p-3 ${isBusy ? "opacity-50" : ""}`}
												variant="secondary"
											>
												<Text className="font-semibold text-foreground text-sm">
													{item.label}
												</Text>
												<Text className="text-muted text-sm leading-5">
													{item.prompt}
												</Text>
											</Surface>
										</Pressable>
									))}
								</View>
							</View>
						)}
					</ScrollView>

					{error && (
						<Surface className="mb-3 rounded-xl p-3" variant="secondary">
							<FieldError isInvalid>
								<Text className="font-medium text-danger text-sm" selectable>
									{error.message}
								</Text>
							</FieldError>
						</Surface>
					)}

					<Separator className="mb-3" />

					<View className="flex-row items-end gap-2 pb-4">
						<View className="flex-1">
							<TextField>
								<Input
									editable={!isBusy}
									onChangeText={setInput}
									onSubmitEditing={() => sendPrompt(input)}
									placeholder="Message AI..."
									returnKeyType="send"
									value={input}
								/>
							</TextField>
						</View>
						<Button
							isDisabled={!canSend}
							isIconOnly
							onPress={() => sendPrompt(input)}
							size="sm"
							variant={canSend ? "primary" : "secondary"}
						>
							<Ionicons
								color={canSend ? foregroundColor : mutedColor}
								name="arrow-up"
								size={18}
							/>
						</Button>
					</View>
				</View>
			</KeyboardAvoidingView>
		</Container>
	);
}
