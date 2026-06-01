#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the Swift AspenTTS plugin with Capacitor's Objective-C runtime.
// Xcode will prompt to create a bridging header when this .m is added — click Create.
CAP_PLUGIN(AspenTTS, "AspenTTS",
    CAP_PLUGIN_METHOD(speak, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)
