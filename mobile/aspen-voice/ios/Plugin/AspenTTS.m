#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the Swift AspenTTS plugin with Capacitor's Objective-C runtime.
CAP_PLUGIN(AspenTTS, "AspenTTS",
    CAP_PLUGIN_METHOD(speak, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(prepareVoice, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(voiceStatus, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setEngine, CAPPluginReturnPromise);
)
