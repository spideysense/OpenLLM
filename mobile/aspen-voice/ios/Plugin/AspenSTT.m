#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the Swift AspenSTT plugin with Capacitor's Objective-C runtime.
CAP_PLUGIN(AspenSTT, "AspenSTT",
    CAP_PLUGIN_METHOD(checkPerms, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestPerms, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)
