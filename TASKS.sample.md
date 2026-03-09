# NeuroFuel MVP Task Breakdown (4-6 Weeks)

## 0. Setup and Project Foundation (Week 1)
- [ ] Create Android app skeleton (Kotlin + Compose + Material 3).
- [ ] Set up package structure: `ui`, `screens`, `components`, `theme`, `viewmodel`, `data`, `repository`, `datasource`, `model`, `database`, `navigation`, `util`.
- [ ] Configure MVVM baseline with state-driven screen architecture.
- [ ] Add Room dependencies and baseline DB module.
- [ ] Create base navigation with 4 bottom tabs + central FAB flow.
- [ ] Define shared UI states for screens: Loading, Empty, Error, Content.

## 1. Core Data Models and Persistence (Week 1)
- [ ] Create Room entities: `MealEntity`, `BrainScoreEntity`.
- [ ] Create DAOs with suspend CRUD + Flow observers.
- [ ] Create repository interfaces + implementations for meals and brain scores.
- [ ] Add mappers between database entities and domain models.
- [ ] Add seed/test utility data for local development.

## 2. Smart Food Logging (Week 1-2)
- [ ] Build Manual Meal Entry screen:
  - [ ] Meal type (Breakfast/Lunch/Dinner/Snack)
  - [ ] Nutrition fields (calories, protein, carbs, fat)
  - [ ] Notes + timestamp
- [ ] Build meal history/list screen with pull-to-refresh.
- [ ] Add create/edit/delete meal flows in ViewModel.
- [ ] Integrate CameraX capture flow and persist photo URI with meal.
- [ ] Add empty state and shimmer loading UI for meal screens.
- [ ] Add haptic feedback for key interactions (FAB, save, delete).

## 3. Brain Score Tracking (Week 2-3)
- [ ] Build brain score input screen with 4 dimensions:
  - [ ] Focus
  - [ ] Clarity
  - [ ] Energy
  - [ ] Mood
- [ ] Save and display historical entries by day.
- [ ] Create gradient brain score gauge component.
- [ ] Add pull-to-refresh + empty/error/loading states.
- [ ] Ensure state restoration and process death resilience.

## 4. Insights and Analytics MVP (Week 3-4)
- [ ] Implement trend analysis for brain scores over time.
- [ ] Implement correlation engine between nutrition and brain score changes.
- [ ] Build "Top Brain Foods" ranking from historical data.
- [ ] Build weekly report screen (averages, trends, top meals, correlations).
- [ ] Add minimum sample-size safeguards for correlation output.

## 5. UI/UX Polish and Accessibility (Week 4-5)
- [ ] Add animated transitions between major screens.
- [ ] Standardize shimmer loading components across data screens.
- [ ] Add reusable empty-state components with CTA actions.
- [ ] Complete accessibility pass:
  - [ ] Content descriptions
  - [ ] Touch targets
  - [ ] Contrast/readability checks
  - [ ] Screen reader friendly labels/order
- [ ] Validate bottom nav + FAB interactions with haptics enabled.

## 6. Testing and Quality Gates (Week 5-6)
- [ ] Unit tests for ViewModels (meal, brain score, insights flows).
- [ ] Repository + DAO tests using Room test DB.
- [ ] Utility tests for correlation and weekly aggregation logic.
- [ ] Smoke test all screens for Loading/Empty/Error/Content states.
- [ ] Run build and test gates:
  - [ ] `./gradlew assembleDebug`
  - [ ] `./gradlew test`

## 7. Release Readiness
- [ ] Verify no secrets/API keys in source control.
- [ ] Check performance for unnecessary recompositions.
- [ ] Ensure no blocking work in composables/main thread.
- [ ] Final QA on clean install and fresh-user empty dataset flow.

## Definition of Done
- [ ] All core MVP features functional offline with Room.
- [ ] All listed tests pass.
- [ ] No compile errors.
- [ ] Navigation + FAB + pull-to-refresh + accessibility baseline verified.
