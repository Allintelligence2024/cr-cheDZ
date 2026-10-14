allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// director-mobile (2026-10-09) : sentry_flutter 8.14.2 applique son propre KGP
// et compile en Kotlin languageVersion 1.6, que Kotlin 2.4 (AGP 9) refuse :
// "Language version 1.6 is no longer supported; use version 2.0 or greater".
// On force la version de langue de TOUS les sous-projets (plugins inclus) sur
// 2.0 — compatibilité arrière conservée (2.0 compile du code 1.6), et le JVM
// target reste 17 (app). Built-in Kotlin (android.builtInKotlin=true) est la
// sortie officielle mais exige des plugins compatibles ; ce forçage est le
// correctif minimal qui garde sentry_flutter 8.14.2.
subprojects {
    tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
        compilerOptions {
            languageVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_0)
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
